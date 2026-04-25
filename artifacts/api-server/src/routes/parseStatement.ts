import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { logger } from "../lib/logger";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

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

Examples of correct name output:
  Raw: "PURCHASE AUTHORIZED ON 04/08 WALGREENS STORE 2835 SW 2 OKLAHOMA CITY OK P586098796061092 CARD 0590"
  Clean name: "WALGREENS STORE 2835 SW 2 OKLAHOMA CITY OK"

  Raw: "Dave DavesCafe FEE 260408 0c09674033271f181ac2b2196719436"
  Clean name: "Dave DavesCafe FEE"

  Raw: "PURCHASE AUTHORIZED ON 04/07 SQ *FRESH CLIPS Oklahoma City OK 5336097805846263 CARD 0590"
  Clean name: "SQ *FRESH CLIPS Oklahoma City OK"

  Raw: "PURCHASE AUTHORIZED ON 04/07 OG&E USPAYMENTSBIL 877-306-9274 OK 5346097387954406 CARD 0590"
  Clean name: "OG&E USPAYMENTSBIL 877-306-9274 OK"

  Raw: "PURCHASE AUTHORIZED ON 04/07 Hobby Lobby Vendor San Antonio TX 5346097514852957 CARD 0590"
  Clean name: "Hobby Lobby Vendor San Antonio TX"

══════════════════════════════════════════════
RULE 2 — AMOUNTS (critical, do not confuse)
══════════════════════════════════════════════

There are two statement layouts. Detect which one you are looking at:

-- LAYOUT A: Online Account Summary (one amount column) --
  This is the Wells Fargo website "Account Detail" or "Account Summary" view.
  The structure is: Date column on the LEFT | Description in the MIDDLE | Dollar amount on the RIGHT.
  The ONLY dollar figure on each row is the transaction amount. Use it directly.
  There is NO running balance column in this layout.

  ⚠ CRITICAL — MULTI-LINE DESCRIPTIONS:
  Long descriptions often WRAP onto a second (or third) visual line directly below the first.
  The dollar amount displayed at the far right is ALWAYS anchored to the FIRST line of that entry
  (the line that starts with the date like "04/08/26").
  The wrapped continuation lines that follow do NOT have their own dollar amount.

  HOW TO MATCH AMOUNT TO TRANSACTION:
    Step 1: Find each row that begins with a date (MM/DD/YY) in the leftmost column.
    Step 2: The dollar amount on that same date-row is this transaction's amount.
    Step 3: Any lines below that date-row WITHOUT a new date are continuation of the same description — ignore their position when counting amounts.
    Step 4: The NEXT date-row is a completely separate transaction with its own separate amount.

  Example (descriptions wrapped across two visual lines):
    04/08/26  PURCHASE AUTHORIZED ON 04/08 WALGREENS STORE 2835 SW    $14.03
              2 OKLAHOMA CITY OK P586098796061092 CARD 0590
    04/08/26  PURCHASE AUTHORIZED ON 04/08 WALGREENS STORE 2835 SW    $11.64
              2 OKLAHOMA CITY OK P466098793692656 CARD 0590
    04/08/26  PURCHASE AUTHORIZED ON 04/07 SQ *FRESH CLIPS OKC OK     $38.00
              5336097805846263 CARD 0590

  In this example there are THREE separate transactions:
    → Walgreens at $14.03
    → Walgreens at $11.64  (NOT Fresh Clips — a new date line = new transaction)
    → SQ *FRESH CLIPS at $38.00  (NOT $11.64 — never borrow an amount from a prior row)

  NEVER shift amounts down: the amount on line N belongs to the transaction on line N, not line N+1.

-- LAYOUT B: PDF Monthly Statement (two amount columns) --
  Columns: Date | Description | Withdrawals | Deposits | Daily Balance
  Each row ends with TWO numbers:
    04/08  WALGREENS STORE ... CARD 0590    14.03         834.81
  GOLDEN RULE: RIGHT number = Daily Balance (IGNORE IT). LEFT number = transaction amount (USE IT).
  Example:
    "DAVE DAVESCAFE FEE 260408 0c09674...    1.00    9.45"
    → amount = 1.00  (NOT 9.45)

Numbers inside the description are reference codes, not amounts:
  "WALGREENS P586098796061092 CARD 0590   14.03   834.81"
  P586098796061092 and 0590 are card/ref numbers. Amount = 14.03.

If an amount has a minus sign, parentheses, or appears in red → expense, use absolute value.

══════════════════════════════════
RULE 3 — EXPENSE vs INCOME
══════════════════════════════════

EXPENSES (type: "expense") — money going OUT:
- All purchases, payments to merchants, subscriptions
- Transfers TO another account ("Online Transfer to...", "Transfer Debit to...")
- Loan/bill payments ("WF Loan/Line Auto Pay", "Affirm Pay", "Synchrony Bank Payment")
- "Save As You Go Transfer Debit" entries (savings transfers are expenses)
- Insurance, utility, service payments
- Cash App sends and outgoing P2P transfers
- Anything in the Withdrawals/Subtractions column

INCOME (type: "income") — money coming IN:
- Direct deposits from employers ("Dir Dep", "PR Dir Dep", "Payroll")
- Gig platform deposits (Amazon Flex, DoorDash, Uber, Lyft, Grubhub, Instacart)
- Incoming P2P transfers received FROM someone
  - Wells Fargo: "Money Transfer authorized on [date] From [name]" = INCOME, incomeSource: "Cash Transfer"
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
- Standalone daily/ending balance lines (a line that is ONLY a balance amount with no merchant name)
- Account numbers, routing numbers, statement period headers
- Section headers like "Deposits and other credits" or "Withdrawals and other debits"
- Wells Fargo Rewards credit points lines
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

async function extractChunk(text: string, chunkIndex: number): Promise<RawTx[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Extract EVERY SINGLE transaction from this bank statement segment (segment ${chunkIndex + 1}). Read every line carefully. In Wells Fargo PDF statements each row ends with TWO numbers — use the LEFT one (transaction amount), ignore the RIGHT one (Daily Balance). Clean names per Rule 1: strip "PURCHASE AUTHORIZED ON MM/DD", strip "CARD XXXX", strip long reference codes (6+ digits), keep merchant name and city/state. Do not skip any transaction. Return only the JSON array.\n\n---\n${text}`,
      },
    ],
    max_completion_tokens: 8192,
    temperature: 0,
    seed: 42 + chunkIndex,
  });

  const choice = response.choices[0];
  const rawContent = choice?.message?.content ?? "[]";
  const finishReason = choice?.finish_reason;

  logger.info({
    chunkIndex,
    finishReason,
    completionTokens: response.usage?.completion_tokens,
    contentLength: rawContent.length,
  }, "Chunk response");

  try {
    const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((tx: RawTx) => ({ ...tx, name: cleanName(tx.name) }));
  } catch {
    logger.error({ chunkIndex, rawContent: rawContent.slice(0, 500) }, "Failed to parse chunk JSON");
    return [];
  }
}

function normalizeDate(raw: string): string {
  if (!raw) return raw;
  const parts = raw.replace(/\//g, "-").split("-");
  if (parts.length !== 3) return raw;
  const [m, d, y] = parts;
  return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y.length === 2 ? `20${y}` : y}`;
}

// Applied server-side after GPT returns, as a safety net for names GPT didn't clean fully
function cleanName(raw: string): string {
  if (!raw) return raw;
  let name = raw.trim();

  // Strip "PURCHASE AUTHORIZED ON MM/DD" prefix (very common in Wells Fargo)
  name = name.replace(/^PURCHASE\s+AUTHORIZED\s+ON\s+\d{2}\/\d{2}\s*/i, "");
  // Strip "PURCHASE AUTHORIZED" prefix without date
  name = name.replace(/^PURCHASE\s+AUTHORIZED\s*/i, "");

  // Strip "CARD XXXX" and everything after it
  name = name.replace(/\s+CARD\s+\d{3,6}\b.*/i, "");

  // Strip P-prefixed or C-prefixed long reference codes (e.g. P586098796061092)
  name = name.replace(/\s+[PC]\d{6,}/gi, "");

  // Strip standalone long digit sequences (8+ digits) that are reference codes
  name = name.replace(/\s+\d{8,}/g, "");

  // Strip long hex strings (16+ hex chars)
  name = name.replace(/\s+[0-9a-f]{16,}/gi, "");

  // Strip trailing 6-digit date stamps like "260408"
  name = name.replace(/\s+\d{6}\b/g, "");

  // Normalize whitespace
  name = name.replace(/\s+/g, " ").trim();

  return name || raw.trim();
}

function normalizeName(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[*]/g, "")
    .replace(/\d{4,}/g, "");
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

router.post("/parse-statement", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { mimetype, buffer } = req.file;
  logger.info({ mimetype, size: buffer.length }, "Parsing bank statement");

  try {
    if (mimetype === "application/pdf") {
      if (buffer.length < 500) {
        res.status(422).json({ error: "This file is too small to be a real bank statement PDF. Please make sure you are uploading the actual PDF file, not a shortcut or link." });
        return;
      }

      const header = buffer.slice(0, 5).toString("ascii");
      if (!header.startsWith("%PDF")) {
        res.status(422).json({ error: "This file does not appear to be a valid PDF. Please upload the original PDF file from your bank." });
        return;
      }

      let pdfData: { text: string };
      try {
        pdfData = await pdfParse(buffer);
      } catch (pdfErr: unknown) {
        const pdfMsg = pdfErr instanceof Error ? pdfErr.message : "PDF parse failed";
        logger.error({ pdfErr }, "PDF parse library error");
        res.status(422).json({ error: `Could not read this PDF — it may be corrupted, password-protected, or an unsupported format. Try downloading it again from your bank, or export as CSV instead. (Detail: ${pdfMsg})` });
        return;
      }

      const fullText = pdfData.text?.trim() ?? "";

      if (!fullText || fullText.length < 20) {
        res.status(422).json({ error: "Could not extract text from this PDF. It may be a scanned image — try exporting as CSV from your bank." });
        return;
      }

      logger.info({ chars: fullText.length }, "Extracted PDF text");

      const CHUNK_SIZE = 7000;
      const OVERLAP = 400;
      const chunks: string[] = [];

      for (let start = 0; start < fullText.length; start += CHUNK_SIZE - OVERLAP) {
        chunks.push(fullText.slice(start, start + CHUNK_SIZE));
        if (start + CHUNK_SIZE >= fullText.length) break;
      }

      logger.info({ chunkCount: chunks.length, totalChars: fullText.length }, "Processing chunks in parallel");

      const chunkResults = await Promise.all(chunks.map((chunk, i) => extractChunk(chunk, i)));
      const allTxs = chunkResults.flat();
      const transactions = deduplicateTxs(allTxs);

      logger.info({
        rawTotal: allTxs.length,
        afterDedup: transactions.length,
        chunkCounts: chunkResults.map((c) => c.length),
      }, "Merged and deduplicated chunks");

      res.json({
        transactions,
        diagnostic: {
          chunks: chunks.length,
          chunkCounts: chunkResults.map((c) => c.length),
          rawTotal: allTxs.length,
          afterDedup: transactions.length,
          pdfChars: fullText.length,
        },
      });
    } else {
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimetype};base64,${base64}`;

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 85_000);

      // ── Phase 1: extract a simple pipe-separated table from the image ──────
      // The AI only has to fill a fixed-format table — no JSON, no layout decisions.
      // Server does all the conversion, cleaning, and typing.
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
                    text: `This is a bank statement. Output a pipe-separated table — ONE LINE PER TRANSACTION — in this exact format:

DATE | AMOUNT | TYPE | RAW_DESCRIPTION

Rules:
1. DATE: the date shown in the leftmost column for that transaction (MM/DD/YY or MM/DD/YYYY).
2. AMOUNT: the dollar number at the FAR RIGHT of that same date's row. No $ sign. Positive number only.
   - If the layout has ONE amount column (online summary): use that number directly.
   - If the layout has TWO amount columns (PDF statement): use the LEFT number; the right number is the running balance and must be ignored.
3. TYPE: write "expense" if money left the account, "income" if money came in.
4. RAW_DESCRIPTION: the full description text for that date row. If the description wraps onto a second line with no date, include the wrapped text on the SAME output line (don't split it).

CRITICAL RULES:
- Each date in the left column = exactly one output line.
- A line with NO date in the left column is a continuation of the previous transaction — do NOT give it its own output line.
- NEVER copy the amount from one row to a different row. Each output line's AMOUNT must be the number on the FAR RIGHT of that specific date row.
- Output NOTHING except the pipe-separated lines. No headers, no explanation, no blank lines.`,
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
        logger.info({ finishReason: phase1.choices[0]?.finish_reason, tableLines: tableText.split("\n").length }, "Phase 1 table extracted");
      } finally {
        clearTimeout(timeoutId);
      }

      // ── Phase 2: server-side parse of the table → RawTx[] ─────────────────
      const transactions: RawTx[] = [];
      for (const rawLine of tableText.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;

        const parts = line.split("|").map((s) => s.trim());
        if (parts.length < 3) continue;

        const [dateRaw, amountRaw, typeRaw, ...descParts] = parts;
        // Require a real description column; with only DATE|AMOUNT|TYPE, parts[2] is type — not a merchant name
        const rawDesc = descParts.join(" ").trim();
        if (!rawDesc) continue;

        // Validate date
        const date = normalizeDate(dateRaw.replace(/[^0-9/\-]/g, "").trim());
        if (!date || date.length !== 10) continue;

        // Validate amount — strip currency symbols, commas
        const amount = parseFloat(amountRaw.replace(/[^0-9.]/g, ""));
        if (isNaN(amount) || amount <= 0) continue;

        const type: "expense" | "income" = (typeRaw ?? "").toLowerCase().includes("income") ? "income" : "expense";

        // Classify incomeSource for income transactions
        const descLower = rawDesc.toLowerCase();
        let incomeSource: string | null = null;
        if (type === "income") {
          if (/payroll|salary|direct dep|dir dep/i.test(descLower)) incomeSource = "Payroll";
          else if (/amazon flex|doordash|uber|lyft|grubhub|instacart/i.test(descLower)) incomeSource = "Gig Work";
          else if (/transfer.*from|money transfer.*from/i.test(descLower)) incomeSource = "Cash Transfer";
          else incomeSource = "Other Income";
        }

        transactions.push({
          date,
          name: cleanName(rawDesc),
          amount,
          type,
          incomeSource,
          confidence: "high",
        });
      }

      logger.info({ parsed: transactions.length, tableText: tableText.slice(0, 800) }, "Phase 2 parse complete");

      res.json({
        transactions,
        diagnostic: { chunks: 1, chunkCounts: [transactions.length], rawTotal: transactions.length, afterDedup: transactions.length },
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Failed to parse statement");
    res.status(500).json({ error: message });
  }
});

export default router;
