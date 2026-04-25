import Papa from "papaparse";
import { isKnownExpenseMerchant } from "./rulesEngine";

export interface ParsedRow {
  date: string;
  name: string;
  amount: number;
  rawCategory?: string;
  txType?: "income" | "expense";
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Total raw lines Papa parsed, before our row-level filtering. */
  rawRowCount: number;
  /** Detected layout, surfaced to the user as a parser hint. */
  detectedFormat: "header_row" | "wells_fargo_5col" | "unknown";
  /** Header keys we recognised (header layouts only). */
  detectedHeaders?: string[];
  /** First raw row contents (for diagnostics if 0 rows parsed). */
  firstRawRow?: string[];
}

/** Public alias kept compatible with all current callers. */
export function parseCSV(file: File): Promise<ParsedRow[]> {
  return parseCSVWithDiagnostics(file).then((r) => r.rows);
}

/**
 * Two-strategy CSV parser:
 *
 *  1) Strategy A — Header row layout (most banks, Mint, Empower, etc.)
 *     Detect known header keys (Date / Description / Amount / Debit / Credit …)
 *     and map each row by name.
 *
 *  2) Strategy B — Wells Fargo's headerless 5-column "Account Activity" export:
 *       "MM/DD/YYYY","-11.29","*","","CHICK FIL A"
 *     No header row. Columns are Date, Amount (signed), *, *, Description.
 *     We detect this by checking whether the first parsed row's first cell
 *     looks like a date AND the second cell looks like a number.
 *
 * If Strategy A yields zero usable rows, we automatically retry with
 * Strategy B before giving up. The caller gets diagnostics so the UI can
 * tell the user whether the file was unreadable, recognised but empty, or
 * recognised but every row got filtered.
 */
export function parseCSVWithDiagnostics(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    // Strategy A — header-aware parse
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as Record<string, string>[];
          const headers = results.meta?.fields ?? [];
          const headerKeys = new Set(headers.map((h) => h.toLowerCase().trim()));
          const HEADER_HINTS = ["date", "description", "amount", "credit", "debit", "name", "payee", "transaction date", "posted date"];
          const looksLikeHeaderLayout = HEADER_HINTS.some((h) => headerKeys.has(h));

          if (looksLikeHeaderLayout) {
            const parsed = mapHeaderRows(rows);
            if (parsed.length > 0) {
              resolve({ rows: parsed, rawRowCount: rows.length, detectedFormat: "header_row", detectedHeaders: headers });
              return;
            }
          }

          // Fall through to Strategy B (Wells Fargo headerless)
          parseHeaderless(file).then(resolve).catch(reject);
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}

function parseHeaderless(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as string[][];
          const firstRaw = rows[0];
          const looksLikeWellsFargo =
            !!firstRaw &&
            firstRaw.length >= 3 &&
            isLikelyDateString(firstRaw[0] ?? "") &&
            isLikelyAmountString(firstRaw[1] ?? "");

          if (!looksLikeWellsFargo) {
            resolve({ rows: [], rawRowCount: rows.length, detectedFormat: "unknown", firstRawRow: firstRaw });
            return;
          }

          const parsed: ParsedRow[] = [];
          for (const row of rows) {
            if (!row || row.length < 3) continue;
            const date = normalizeDate(row[0] ?? "");
            // Description is always the LAST non-empty cell in Wells Fargo's layout
            const name = (row[row.length - 1] ?? "").trim();
            const amountRaw = row[1] ?? "0";
            const signed = parseFloat(amountRaw.replace(/[$,"]/g, "")) || 0;
            const rawAmount = Math.abs(signed);
            const txType: "income" | "expense" =
              signed > 0 && !isKnownExpenseMerchant(name, rawAmount) ? "income" : "expense";

            if (!date || !name || rawAmount === 0) continue;
            parsed.push({ date, name, amount: rawAmount, txType });
          }

          resolve({ rows: parsed, rawRowCount: rows.length, detectedFormat: "wells_fargo_5col", firstRawRow: firstRaw });
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}

function mapHeaderRows(rows: Record<string, string>[]): ParsedRow[] {
  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    // Some banks export headers with extra spaces (e.g. " description")
    // or mixed case. Normalize keys once per row so lookups are robust.
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      normalized[k.toLowerCase().trim()] = v;
    }

    const get = (...keys: string[]) => {
      for (const key of keys) {
        const val = normalized[key.toLowerCase().trim()];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          return String(val);
        }
      }
      return "";
    };

    const date = normalizeDate(
      get("Date", "Transaction Date", "Posted Date", "Posting Date")
    );
    const name = (
      get("Description", "Name", "Payee", "Memo", "Details")
    ).trim();

    const creditRaw = get("Credit", "Deposit");
    const debitRaw = get("Debit", "Withdrawal");

    let rawAmount: number;
    let txType: "income" | "expense";

    if (creditRaw || debitRaw) {
      const credit = parseFloat(creditRaw.replace(/[$,]/g, "")) || 0;
      const debit = parseFloat(debitRaw.replace(/[$,]/g, "")) || 0;
      if (credit > 0) {
        rawAmount = credit;
        txType = "income";
      } else {
        rawAmount = debit;
        txType = "expense";
      }
    } else {
      const amountRaw = get("Amount", "Transaction Amount", "Value", "Amount ($)") || "0";
      const signed = parseFloat(amountRaw.replace(/[$,]/g, "")) || 0;
      rawAmount = Math.abs(signed);
      txType = signed > 0 && !isKnownExpenseMerchant(name, rawAmount) ? "income" : "expense";
    }

    const rawCategory = get("Category", "Type") || undefined;
    if (!date || !name || rawAmount === 0) continue;
    parsed.push({ date, name, amount: rawAmount, rawCategory, txType });
  }
  return parsed;
}

function isLikelyDateString(value: string): boolean {
  const v = value.replace(/"/g, "").trim();
  if (!v) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

function isLikelyAmountString(value: string): boolean {
  const v = value.replace(/[$,"\s]/g, "").trim();
  if (!v) return false;
  return /^-?\d+(\.\d+)?$/.test(v);
}

function normalizeDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw.trim());
  if (isNaN(d.getTime())) return raw.trim();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

export function exportToCSV(
  rows: Array<{ date: string; name: string; amount: number; category: string }>,
  filename: string
): void {
  const csv = Papa.unparse(rows, { header: true });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
