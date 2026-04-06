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

            // Check for split debit/credit columns first (some banks export Amount, Debit, Credit separately)
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
              // Single Amount column: positive = deposit (income), negative = withdrawal (expense)
              const amountRaw =
                row["Amount"] ||
                row["amount"] ||
                row["Transaction Amount"] ||
                "0";
              const signed = parseFloat(amountRaw.replace(/[$,]/g, "")) || 0;
              rawAmount = Math.abs(signed);
              // Positive means credit/deposit → income; negative means debit/withdrawal → expense
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
