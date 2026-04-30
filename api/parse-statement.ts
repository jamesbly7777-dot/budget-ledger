import type { IncomingMessage, ServerResponse } from "node:http";
import formidable from "formidable";
import OpenAI from "openai";
import fs from "node:fs";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export const config = {
  api: {
    bodyParser: false,
    maxDuration: 60,
  },
};

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a bank statement parser. Extract ALL transactions from the provided bank statement image or text — both income/deposits and expenses/withdrawals.

IMPORTANT: Extract EVERY visible transaction — do not skip any. Be exhaustive. Never fabricate transactions not present in the source.

Return ONLY a valid JSON array (no markdown, no explanation, no code fences) in this exact format:
[
  {
    "date": "MM/DD/YYYY",
    "name": "Cleaned merchant name",
    "amount": 12.34,
    "type": "expense",
    "incomeSource": null,
    "confidence": "high"
  }
]

══════════════════════════════════════════════
RULE 1 — NAME CLEANING (critical)
══════════════════════════════════════════════

After identifying the raw description, clean it as follows before putting it in "name":

STRIP these from the name (they add noise, not meaning):
  a) Leading prefix "PURCHASE AUTHORIZED ON MM/DD" or "PURCHASE AUTHORIZED"
     Example: "PURCHASE AUTHORIZED ON 04/08 WALGREENS STORE OKC OK" → "WALGREENS STORE OKC OK"
  b) Trailing "CARD XXXX" and everything after it
     Example: "WALGREENS STORE OKC OK CARD 0590" → "WALGREENS STORE OKC OK"
  c) Long reference codes: any sequence of 6+ digits (P586098796061092, 5336097805846263, etc.)
     Example: "WALGREENS STORE P586098796061092" → "WALGREENS STORE"
  d) Long hex strings (0c09674033271f181ac2b2196719436 etc.)
  e) Trailing date stamps embedded in name ("260408" in "Dave DavesCafe FEE 260408")
     Example: "Dave DavesCafe FEE 260408 0c09674..." → "Dave DavesCafe FEE"
  f) Account mask patterns: "TO XXXXXXXXXX3037" → strip the X's, keep "TO ...3037" or just the label

KEEP in the name:
  - Merchant name and brand ("WALGREENS", "HOBBY LOBBY", "AMAZON", "SQ *FRESH CLIPS")
  - City and state if present ("OKC OK", "OKLAHOMA CITY", "SEATTLE WA")
  - Short meaningful suffixes like "FEE", "ONLINE", "PAYMENT"
  - "Save As You Go Transfer Debit" → keep as-is (it is meaningful)

══════════════════════════════════════════════
RULE 2 — AMOUNTS (critical, do not confuse)
══════════════════════════════════════════════

There are two statement layouts. Detect which one you are looking at:

-- LAYOUT A: Online Account Summary (one amount column) --
  The structure is: Date column on the LEFT | Description in the MIDDLE | Dollar amount on the RIGHT.
  The ONLY dollar figure on each row is the transaction amount. Use it directly.
  There is NO running balance column in this layout.

  ⚠ CRITICAL — MULTI-LINE DESCRIPTIONS:
  Long descriptions often WRAP onto a second (or third) visual line directly below the first.
  The dollar amount displayed at the far right is ALWAYS anchored to the FIRST line of that entry.
  The wrapped continuation lines that follow do NOT have their own dollar amount.

-- LAYOUT B: PDF Monthly Statement (two amount columns) --
  Columns: Date | Description | Withdrawals | Deposits | Daily Balance
  GOLDEN RULE: RIGHT number = Daily Balance (IGNORE IT). LEFT number = transaction amount (USE IT).

If an amount has a minus sign, parentheses, or appears in red → expense, use absolute value.

══════════════════════════════════
RULE 3 — EXPENSE vs INCOME
══════════════════════════════════

EXPENSES (type: "expense") — money going OUT:
- All purchases, payments to merchants, subscriptions
- Transfers TO another account ("Online Transfer to...", "Transfer Debit to...")
- Loan/bill payments ("WF Loan/Line Auto Pay", "Affirm Pay", "Synchrony Bank Payment")
- "Save As You Go Transfer Debit" entries (savings transfers are expenses)
- Anything in the Withdrawals/Subtractions column

INCOME (type: "income") — money coming IN:
- Direct deposits from employers ("Dir Dep", "PR Dir Dep", "Payroll")
- Gig platform deposits (Amazon Flex, DoorDash, Uber, Lyft, Grubhub, Instacart)
- Incoming P2P transfers received FROM someone
- Tax refunds, bank bonuses = INCOME, incomeSource: "Other Income"
- Anything in the Deposits/Additions column

Field rules:
- date: format as MM/DD/YYYY. If the year is missing, infer it from the statement header.
- amount: always a POSITIVE number (absolute value). Never include the dollar sign.
- incomeSource: for income only — pick from: "Payroll", "Gig Work", "Cash Transfer", "Side Business", "Other Income". Set to null for expenses.
- confidence: "high" if clearly legible, "medium" if partial, "low" if unclear.

══════════════════════════════════
EXCLUDE ENTIRELY (no JSON entry)
══════════════════════════════════
- Standalone daily/ending balance lines
- Account numbers, routing numbers, statement period headers
- Section headers like "Deposits and other credits" or "Withdrawals and other debits"
- Any line that has no associated transaction description

Return [] if no transactions are found.`;

interface RawTx {
  date: string;
  name: string;
  amount: number;
  type?: string;
  incomeSource?: string | null;
  confidence?: string;
}

function cleanName(raw: string): string {
  if (!raw) return raw;
  let name = raw.trim();
  name = name.replace(/^PURCHASE\s+AUTHORIZED\s+ON\s+\d{2}\/\d{2}\s*/i, "");
  name = name.replace(/^PURCHASE\s+AUTHORIZED\s*/i, "");
  name = name.replace(/\s+CARD\s+\d{3,6}\b.*/i, "");
  name = name.replace(/\s+[PC]\d{6,}/gi, "");
  name = name.replace(/\s+\d{8,}/g, "");
  name = name.replace(/\s+[0-9a-f]{16,}/gi, "");
  name = name.replace(/\s+\d{6}\b/g, "");
  name = name.replace(/\s+/g, " ").trim();
  return name || raw.trim();
}

function normalizeDate(raw: string): string {
  if (!raw) return raw;
  const parts = raw.replace(/\//g, "-").split("-");
  if (parts.length !== 3) return raw;
  const [m, d, y] = parts;
  return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y.length === 2 ? `20${y}` : y}`;
}

function normalizeName(raw: string): string {
  return (raw ?? "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[*]/g, "").replace(/\d{4,}/g, "");
}

function deduplicateTxs(txs: RawTx[]): RawTx[] {
  const seen = new Set<string>();
  const result: RawTx[] = [];
  for (const tx of txs) {
    const key = `${normalizeDate(tx.date)}|${normalizeName(tx.name)}|${Math.abs(tx.amount ?? 0).toFixed(2)}|${tx.type ?? "expense"}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tx);
    }
  }
  return result;
}

async function extractChunk(text: string, chunkIndex: number): Promise<RawTx[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Extract EVERY SINGLE transaction from this bank statement segment (segment ${chunkIndex + 1}). Read every line carefully. In Wells Fargo PDF statements each row ends with TWO numbers — use the LEFT one (transaction amount), ignore the RIGHT one (Daily Balance). Clean names per Rule 1. Do not skip any transaction. Return only the JSON array.\n\n---\n${text}`,
      },
    ],
    max_completion_tokens: 8192,
    temperature: 0,
    seed: 42 + chunkIndex,
  });

  const rawContent = response.choices[0]?.message?.content ?? "[]";
  try {
    const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((tx: RawTx) => ({ ...tx, name: cleanName(tx.name) }));
  } catch {
    return [];
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
  let files: formidable.Files;
  try {
    [, files] = await form.parse(req);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to parse uploaded file" }));
    return;
  }

  const fileField = files["file"];
  const uploadedFile = Array.isArray(fileField) ? fileField[0] : fileField;
  if (!uploadedFile) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No file uploaded" }));
    return;
  }

  const { mimetype, filepath } = uploadedFile;
  const buffer = fs.readFileSync(filepath);

  try {
    if (mimetype === "application/pdf") {
      if (buffer.length < 500) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File too small to be a real bank statement PDF." }));
        return;
      }
      if (!buffer.slice(0, 5).toString("ascii").startsWith("%PDF")) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File does not appear to be a valid PDF." }));
        return;
      }

      let pdfData: { text: string };
      try {
        pdfData = await pdfParse(buffer);
      } catch (pdfErr: unknown) {
        const msg = pdfErr instanceof Error ? pdfErr.message : "PDF parse failed";
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Could not read this PDF — it may be corrupted or password-protected. (${msg})` }));
        return;
      }

      const fullText = pdfData.text?.trim() ?? "";
      if (!fullText || fullText.length < 20) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not extract text from this PDF. It may be a scanned image — try exporting as CSV from your bank." }));
        return;
      }

      const CHUNK_SIZE = 7000;
      const OVERLAP = 400;
      const chunks: string[] = [];
      for (let start = 0; start < fullText.length; start += CHUNK_SIZE - OVERLAP) {
        chunks.push(fullText.slice(start, start + CHUNK_SIZE));
        if (start + CHUNK_SIZE >= fullText.length) break;
      }

      const chunkResults = await Promise.all(chunks.map((chunk, i) => extractChunk(chunk, i)));
      const allTxs = chunkResults.flat();
      const transactions = deduplicateTxs(allTxs);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        transactions,
        diagnostic: {
          chunks: chunks.length,
          chunkCounts: chunkResults.map((c) => c.length),
          rawTotal: allTxs.length,
          afterDedup: transactions.length,
          pdfChars: fullText.length,
        },
      }));
    } else {
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimetype};base64,${base64}`;

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 55_000);

      let tableText = "";
      try {
        const phase1 = await openai.chat.completions.create(
          {
            model: "gpt-4o",
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
                  {
                    type: "text",
                    text: `This is a bank statement. Output a pipe-separated table — ONE LINE PER TRANSACTION — in this exact format:\n\nDATE | AMOUNT | TYPE | RAW_DESCRIPTION\n\nRules:\n1. DATE: the date shown in the leftmost column for that transaction (MM/DD/YY or MM/DD/YYYY).\n2. AMOUNT: the dollar number at the FAR RIGHT of that same date's row. No $ sign. Positive number only.\n   - If the layout has ONE amount column (online summary): use that number directly.\n   - If the layout has TWO amount columns (PDF statement): use the LEFT number; the right number is the running balance and must be ignored.\n3. TYPE: write "expense" if money left the account, "income" if money came in.\n4. RAW_DESCRIPTION: the full description text for that date row.\n\nCRITICAL: Each date in the left column = exactly one output line. Output NOTHING except the pipe-separated lines.`,
                  },
                ],
              },
            ],
            max_completion_tokens: 2048,
            temperature: 0,
          },
          { signal: abortController.signal }
        );
        tableText = phase1.choices[0]?.message?.content ?? "";
      } finally {
        clearTimeout(timeoutId);
      }

      const transactions: RawTx[] = [];
      for (const rawLine of tableText.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const parts = line.split("|").map((s) => s.trim());
        if (parts.length < 3) continue;
        const [dateRaw, amountRaw, typeRaw, ...descParts] = parts;
        const rawDesc = descParts.join(" ").trim() || parts[2];
        const date = normalizeDate(dateRaw.replace(/[^0-9/\-]/g, "").trim());
        if (!date || date.length !== 10) continue;
        const amount = parseFloat(amountRaw.replace(/[^0-9.]/g, ""));
        if (isNaN(amount) || amount <= 0) continue;
        const type: "expense" | "income" = (typeRaw ?? "").toLowerCase().includes("income") ? "income" : "expense";
        const descLower = rawDesc.toLowerCase();
        let incomeSource: string | null = null;
        if (type === "income") {
          if (/payroll|salary|direct dep|dir dep/i.test(descLower)) incomeSource = "Payroll";
          else if (/amazon flex|doordash|uber|lyft|grubhub|instacart/i.test(descLower)) incomeSource = "Gig Work";
          else if (/transfer.*from|money transfer.*from/i.test(descLower)) incomeSource = "Cash Transfer";
          else incomeSource = "Other Income";
        }
        transactions.push({ date, name: cleanName(rawDesc), amount, type, incomeSource, confidence: "high" });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        transactions,
        diagnostic: { chunks: 1, chunkCounts: [transactions.length], rawTotal: transactions.length, afterDedup: transactions.length },
      }));
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  } finally {
    try { fs.unlinkSync(filepath); } catch { /* ignore cleanup errors */ }
  }
}
