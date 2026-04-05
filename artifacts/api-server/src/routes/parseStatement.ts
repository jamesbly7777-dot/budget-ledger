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

const SYSTEM_PROMPT = `You are a bank statement parser. Extract ALL transactions (both income/deposits and expenses/withdrawals) from the provided bank statement TEXT SEGMENT.

IMPORTANT: This may be a SEGMENT of a longer statement. Extract every transaction you can find in this segment — do not skip any. Be exhaustive.

Return ONLY a valid JSON array (no markdown, no explanation) with this exact structure:
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
- date: format as MM/DD/YYYY. If year is missing, use the statement year shown in the header.
- name: use the exact merchant/description from the statement
- amount: always a POSITIVE number (absolute value). Never include the dollar sign.
- type: "expense" for money going OUT, "income" for money coming IN
- incomeSource: only for income, pick from: "Payroll", "Gig Work", "Cash Transfer", "Side Business", "Other Income". Set to null for expenses.
- confidence: "high" if clearly legible, "medium" if partial, "low" if unclear

EXPENSES (type: "expense") — money going OUT:
- All purchases, payments to merchants, subscriptions
- Transfers TO another account ("Online Transfer to...", "Transfer Debit to...")
- Loan/bill payments ("WF Loan/Line Auto Pay", "Affirm Pay", "Synchrony Bank Payment")
- "Save As You Go Transfer Debit" entries (these are expenses, money moving to savings)
- Insurance, utility, service payments
- Cash App sends and outgoing transfers
- Anything in the Withdrawals/Subtractions column

INCOME (type: "income") — money coming IN:
- Direct deposits from employers ("Dir Dep", "PR Dir Dep", "Payroll")
- Gig platform deposits (Amazon Flex, DoorDash, Uber, Lyft, Grubhub, Instacart)
- Incoming person-to-person transfers received FROM someone
  → Wells Fargo: "Money Transfer authorized on [date] From [name]" = INCOME, incomeSource: "Cash Transfer"
- Tax refunds, bank bonuses = INCOME, incomeSource: "Other Income"
- Anything in the Deposits/Additions column

EXCLUDE entirely (do not create entries for):
- Daily balance / ending balance lines
- Account numbers, routing numbers
- Section headers ("Deposits and other credits", "Withdrawals and other debits")
- Wells Fargo Rewards credit points
- Running balance amounts shown after each transaction

Return [] if no transactions found in this segment.`;

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
        content: `Extract every transaction from this bank statement segment (segment ${chunkIndex + 1}). Return only the JSON array.\n\n---\n${text}`,
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

function deduplicateTxs(txs: RawTx[]): RawTx[] {
  const seen = new Set<string>();
  const result: RawTx[] = [];
  for (const tx of txs) {
    const key = `${tx.date}|${tx.name?.toLowerCase().trim()}|${Math.abs(tx.amount ?? 0).toFixed(2)}|${tx.type ?? "expense"}`;
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
      const pdfData = await pdfParse(buffer);
      const fullText = pdfData.text?.trim() ?? "";

      if (!fullText || fullText.length < 20) {
        res.status(422).json({ error: "Could not extract text from this PDF. It may be a scanned image — try exporting as CSV from your bank." });
        return;
      }

      logger.info({ chars: fullText.length }, "Extracted PDF text");

      const CHUNK_SIZE = 12000;
      const OVERLAP = 1500;
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

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
              { type: "text", text: "Extract every transaction from this bank statement image. Return only the JSON array." },
            ],
          },
        ],
        max_completion_tokens: 8192,
        temperature: 0,
        seed: 42,
      });

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
