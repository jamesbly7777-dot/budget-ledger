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

IMPORTANT: Extract EVERY visible transaction — do not skip any. Be exhaustive.

Return ONLY a valid JSON array (no markdown, no explanation, no code fences) in this exact format:
[
  {
    "date": "MM/DD/YYYY",
    "name": "Transaction description as written",
    "amount": 12.34,
    "type": "expense",
    "incomeSource": null,
    "confidence": "high"
  }
]

Field rules:
- date: format as MM/DD/YYYY. If the year is missing, infer it from the statement header.
- name: use the merchant/description as written. Do NOT include card numbers, reference codes, or account numbers in the name.
- amount: always a POSITIVE number (absolute value). Never include the dollar sign.
- type: "expense" for money going OUT, "income" for money coming IN.
- incomeSource: for income only — pick from: "Payroll", "Gig Work", "Cash Transfer", "Side Business", "Other Income". Set to null for expenses.
- confidence: "high" if clearly legible, "medium" if partial, "low" if unclear.

══════════════════════════════════════════════
THE SINGLE MOST IMPORTANT RULE: AMOUNTS
══════════════════════════════════════════════

Every bank statement has TWO types of dollar numbers per row:
  1. The TRANSACTION AMOUNT — the money that moved (what you owe/received)
  2. The RUNNING BALANCE — the account balance AFTER that transaction

You MUST always use the TRANSACTION AMOUNT. NEVER use the running balance.

HOW TO TELL THEM APART — BY STATEMENT FORMAT:

-- FORMAT A: Wells Fargo / Chase PDF Monthly Statement --
  Columns: Date | Description | Withdrawals | Deposits | Daily Balance
  Each row looks like:
    04/08  WALGREENS STORE 2835 SW 2 OKC OK CARD 0590    14.03         9.45
  Here: 14.03 = Withdrawals column = TRANSACTION AMOUNT  <-- USE THIS
        9.45 = Daily Balance column = running account balance  <-- DO NOT USE
  KEY RULE: The RIGHTMOST number on a row is ALWAYS the Daily Balance. Ignore it.
            The number BEFORE the Daily Balance (in the Withdrawals or Deposits column) is the transaction amount.

  Another example with a deposit:
    04/08  DIRECT DEPOSIT PAYROLL                               1500.00   2009.45
  Here: 1500.00 = Deposits column = TRANSACTION AMOUNT  <-- USE THIS
        2009.45 = Daily Balance  <-- DO NOT USE

-- FORMAT B: Wells Fargo / Chase Online Account Summary --
  Columns: Date | Description | Amount (single amount column, no balance shown)
    04/08  WALGREENS STORE  $14.03
  Here: 14.03 = transaction amount.  <-- USE THIS (only one number, easy)

-- FORMAT C: Mobile App Screenshot --
  Transaction Name                  $14.03
  04/08/2026
  Ending Daily Balance: $834.81
  Here: 14.03 = transaction amount (right-aligned next to name)  <-- USE THIS
        834.81 = account balance labeled "Ending Daily Balance"  <-- DO NOT USE

CONCRETE EXAMPLE of the most common mistake to avoid:
  Statement row: "DAVE DAVESCAFE FEE 260408 0c09674...    1.00    9.45"
  WRONG answer: amount = 9.45  (that is the Daily Balance column)
  CORRECT answer: amount = 1.00  (that is the Withdrawals column)

GOLDEN RULE: If a transaction row ends with TWO numbers separated by whitespace,
  the LEFT number is the transaction amount, the RIGHT number is the running balance.
  Always use the LEFT number.

Numbers inside the transaction description are reference codes, NOT amounts:
  "PURCHASE AUTHORIZED WALGREENS P586098796061092 CARD 0590   14.03   834.81"
  P586098796061092 and 0590 are card/reference numbers — never treat them as the amount.
  Amount = 14.03 (the leftmost of the two trailing numbers).

If an amount has a minus sign, parentheses, or appears in red = it is an expense — use the absolute value.

══════════════════════════════════
EXPENSE vs INCOME CLASSIFICATION
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
        content: `Extract EVERY SINGLE transaction from this bank statement segment (segment ${chunkIndex + 1}). Read every line carefully. Remember: in Wells Fargo statements the LAST number on each row is the Daily Balance — use the number BEFORE it as the transaction amount. Do not skip any transaction. Return only the JSON array.\n\n---\n${text}`,
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
    return Array.isArray(parsed) ? parsed : [];
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

      let response;
      try {
        response = await openai.chat.completions.create(
          {
            model: "gpt-4o",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
                  {
                    type: "text",
                    text: "Extract every transaction from this bank statement image. IMPORTANT: In Wells Fargo statements, each row ends with TWO numbers — the transaction amount (left) and the Daily Balance (right). Use ONLY the transaction amount (left number). Return only the JSON array.",
                  },
                ],
              },
            ],
            max_completion_tokens: 2048,
            temperature: 0,
            seed: 42,
          },
          { signal: abortController.signal }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      const rawContent = response.choices[0]?.message?.content ?? "[]";
      logger.info({ finishReason: response.choices[0]?.finish_reason, contentLength: rawContent.length }, "Image response");

      let transactions: RawTx[] = [];
      try {
        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        transactions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
      } catch {
        logger.error({ rawContent: rawContent.slice(0, 500) }, "Failed to parse image response JSON");
      }

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
