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

const SYSTEM_PROMPT = `You are a bank statement parser. Extract ALL transactions (both income/deposits and expenses/withdrawals) from the provided bank statement.

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
- date: format as MM/DD/YYYY. If year is missing, use the current year.
- name: use the exact merchant/description from the statement
- amount: always a POSITIVE number (absolute value). Never include the dollar sign.
- type: "expense" for money going OUT, "income" for money coming IN
- incomeSource: only for income transactions, pick the closest match from:
    "Payroll" — direct deposit from an employer, payroll processor
    "Gig Work" — Amazon Flex, DoorDash, Uber, Lyft, Grubhub, Instacart, gig platforms
    "Cash Transfer" — Cash App, Venmo, Zelle, PayPal, person-to-person transfers received
    "Side Business" — freelance, contractor, self-employment, Etsy, eBay, Shopify
    "Other Income" — tax refunds, insurance claims, bank bonuses, anything else
    Set to null for expense transactions.
- confidence: "high" if clearly legible, "medium" if partially visible, "low" if unclear

EXPENSES (type: "expense") — money going OUT:
- Purchases and payments to merchants
- Recurring payments and subscriptions
- Transfers TO another account (e.g. "Online Transfer to...", "Transfer Debit to...")
- Loan/bill payments (e.g. "WF Loan/Line Auto Pay", "Affirm Pay", "Synchrony Bank Payment")
- "Save As You Go Transfer Debit" entries
- Insurance, utility, and service payments
- Cash App sends and similar outgoing transfers
- Any amount listed in the Withdrawals/Subtractions column

INCOME (type: "income") — money coming IN:
- Direct deposits from employers (e.g. "Dir Dep", "PR Dir Dep", "Payroll")
- Amazon Flex, DoorDash, Uber, or other gig platform deposits
- Incoming Cash App, Venmo, Zelle, PayPal transfers received FROM someone
  → In Wells Fargo: "Money Transfer authorized on [date] From [name]" = INCOME (incomeSource: "Cash Transfer")
- Tax refunds (IRS, state) = INCOME (incomeSource: "Other Income")
- Bank bonuses, cashback credits = INCOME (incomeSource: "Other Income")
- Any amount listed in the Deposits/Additions column

NOTE: In Wells Fargo statements, "Money Transfer authorized on [date] From [name]" = money coming IN = income.
Only "Money Transfer authorized on [date] [payee]" without "From" or with "To" = money going OUT = expense.

EXCLUDE entirely:
- Balance figures, account numbers, running daily balances
- Wells Fargo Rewards credits (these are point redemptions, not cash)
- Duplicate balance lines

Return an empty array [] if no transactions are found.`;


router.post("/parse-statement", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { mimetype, buffer } = req.file;
  logger.info({ mimetype, size: buffer.length }, "Parsing bank statement");

  try {
    let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    if (mimetype === "application/pdf") {
      const pdfData = await pdfParse(buffer);
      const text = pdfData.text?.trim();
      if (!text || text.length < 20) {
        res.status(422).json({ error: "Could not extract text from this PDF. It may be a scanned image PDF — please try exporting it as a CSV from your bank instead." });
        return;
      }
      logger.info({ chars: text.length }, "Extracted PDF text");
      messages = [
        {
          role: "user",
          content: `Extract all transactions from this bank statement text and return only the JSON array.\n\n---\n${text.slice(0, 80000)}`,
        },
      ];
    } else {
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimetype};base64,${base64}`;
      messages = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
            {
              type: "text",
              text: "Extract all transactions from this bank statement image. Return only the JSON array.",
            },
          ],
        },
      ];
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_completion_tokens: 16384,
      temperature: 0,
      seed: 42,
    });

    const rawContent = response.choices[0]?.message?.content ?? "[]";
    logger.info({ rawContent: rawContent.slice(0, 200) }, "OpenAI response");

    let transactions: unknown;
    try {
      const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
      transactions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      logger.error({ rawContent }, "Failed to parse OpenAI response as JSON");
      transactions = [];
    }

    res.json({ transactions, rawResponse: rawContent.slice(0, 500) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err }, "Failed to parse statement");
    res.status(500).json({ error: message });
  }
});

export default router;
