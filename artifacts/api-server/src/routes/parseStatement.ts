import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
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

const SYSTEM_PROMPT = `You are a bank statement parser. Extract every transaction from the provided bank statement image or screenshot.

Return ONLY a valid JSON array (no markdown, no explanation) with this exact structure:
[
  {
    "date": "MM/DD/YYYY",
    "name": "Transaction description as written",
    "amount": 12.34,
    "confidence": "high" | "medium" | "low"
  }
]

Rules:
- date: format as MM/DD/YYYY. If year is missing, use the current year.
- name: use the exact merchant/description from the statement
- amount: always positive number (absolute value). Do NOT include the dollar sign.
- confidence: "high" if clearly legible, "medium" if partially visible, "low" if unclear
- Include ALL transactions — debits, charges, withdrawals
- Exclude: deposits, credits, payments received, balance amounts, account numbers
- If you see a "pending" or "processing" label next to a transaction, still include it
- Do NOT skip any transaction even if confidence is low
- Return empty array [] if no transactions found`;

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
      res.status(415).json({
        error: "PDF parsing not supported directly. Please take a screenshot of your bank statement and upload that instead.",
        code: "PDF_NOT_SUPPORTED",
      });
      return;
    }

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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_completion_tokens: 4096,
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
