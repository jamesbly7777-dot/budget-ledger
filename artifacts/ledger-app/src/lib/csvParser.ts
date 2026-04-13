import Papa from "papaparse";

export interface ParsedRow {
  date: string;
  name: string;
  amount: number;
  rawCategory?: string;
  txType?: "income" | "expense";
}

export function parseCSV(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as Record<string, string>[];
          const parsed: ParsedRow[] = [];

          for (const row of rows) {
            const date = normalizeDate(
              row["Date"] || row["date"] || row["Transaction Date"] || row["Posted Date"] || ""
            );
            const name = (
              row["Description"] ||
              row["description"] ||
              row["Name"] ||
              row["Payee"] ||
              row["name"] ||
              ""
            ).trim();

            const creditRaw = row["Credit"] || row["credit"] || row["Deposit"] || "";
            const debitRaw = row["Debit"] || row["debit"] || row["Withdrawal"] || "";

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
              const amountRaw =
                row["Amount"] ||
                row["amount"] ||
                row["Transaction Amount"] ||
                "0";
              const signed = parseFloat(amountRaw.replace(/[$,]/g, "")) || 0;
              rawAmount = Math.abs(signed);
              txType = signed > 0 ? "income" : "expense";
            }

            const rawCategory =
              row["Category"] || row["category"] || row["Type"] || undefined;

            if (!date || !name || rawAmount === 0) continue;
            parsed.push({ date, name, amount: rawAmount, rawCategory, txType });
          }

          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}

/**
 * Normalize any common bank date format to YYYY-MM-DD (ISO) for consistent
 * storage and lexicographic sorting. Avoids UTC-midnight timezone shift by
 * never feeding ISO strings into `new Date()` without explicit UTC handling.
 */
export function normalizeDate(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // YYYY-MM-DD with optional time (e.g. "2026-04-10T00:00:00")
  const isoTimeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (isoTimeMatch) return isoTimeMatch[1];

  // MM/DD/YYYY or M/D/YYYY or M/D/YY
  const mdySlash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdySlash) {
    const [, m, d, y] = mdySlash;
    const fullYear = y.length === 2 ? `20${y}` : y;
    return `${fullYear}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // MM-DD-YYYY (some exports use dashes with US ordering)
  const mdyDash = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdyDash) {
    const [, m, d, y] = mdyDash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Last resort: parse via Date but read UTC parts to avoid timezone shift
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().substring(0, 10);
  }

  return trimmed;
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
