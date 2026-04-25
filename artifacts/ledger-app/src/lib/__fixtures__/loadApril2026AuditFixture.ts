import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MoneyInKind } from "../billStatus";
import type { TransactionCategory } from "../types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AUDIT_LABEL_TO_CATEGORY: Record<string, TransactionCategory> = {
  "Bills/Debt": "Bills",
  "Bills/Debt / Education": "Bills",
  "Fuel/Work": "Fuel",
  "Necessary Living": "Necessary",
  Medical: "Medical",
  Shopping: "Shopping",
  "Personal / Shopping": "Shopping",
  "Transfers/Savings": "Transfers",
  "Work / AI Tools": "Work",
  Waste: "Waste",
};

const INCOME_LABEL_TO_KIND: Record<string, MoneyInKind> = {
  Income: "earned",
  Refund: "refund_reversal",
  "Transfer In": "internal_transfer",
};

const spendLineRe = /^04\/(\d{2}) — (.+): \$\s*([\d,]+\.\d{2}) — (.+)$/;
const incomeLineRe = /^04\/(\d{2}) — (.+): \+\$\s*([\d,]+\.\d{2}) — (.+)$/;

export interface April2026SpendFixtureRow {
  date: string;
  name: string;
  amount: number;
  expectedCategory: TransactionCategory;
}

export interface April2026IncomeFixtureRow {
  date: string;
  name: string;
  amount: number;
  expectedKind: MoneyInKind;
}

function readFixtureFile(name: string): string {
  return readFileSync(path.join(__dirname, name), "utf8");
}

export function loadApril2026SpendFixture(): April2026SpendFixtureRow[] {
  const raw = readFixtureFile("april2026-audit-spending.source.txt");
  const rows: April2026SpendFixtureRow[] = [];
  for (const line of raw.trim().split("\n")) {
    const m = line.match(spendLineRe);
    if (!m) throw new Error(`Bad April spend fixture line: ${line}`);
    const [, dd, name, amtStr, label] = m;
    const expectedCategory = AUDIT_LABEL_TO_CATEGORY[label.trim()];
    if (!expectedCategory) throw new Error(`Unknown audit category label: ${label}`);
    rows.push({
      date: `2026-04-${dd}`,
      name: name.trim(),
      amount: Number(amtStr.replace(/,/g, "")),
      expectedCategory,
    });
  }
  return rows;
}

/** Sum spending amounts in the source file by audit label (Bills/Debt, etc.) — for regression on constants. */
export function sumSpendFixtureByAuditLabel(): Record<string, number> {
  const raw = readFixtureFile("april2026-audit-spending.source.txt");
  const sums: Record<string, number> = {};
  for (const line of raw.trim().split("\n")) {
    const m = line.match(spendLineRe);
    if (!m) throw new Error(`Bad April spend fixture line: ${line}`);
    const label = m[4].trim();
    const amt = Number(m[3].replace(/,/g, ""));
    sums[label] = (sums[label] ?? 0) + amt;
  }
  return sums;
}

export function loadApril2026IncomeFixture(): April2026IncomeFixtureRow[] {
  const raw = readFixtureFile("april2026-audit-income.source.txt");
  const rows: April2026IncomeFixtureRow[] = [];
  for (const line of raw.trim().split("\n")) {
    const m = line.match(incomeLineRe);
    if (!m) throw new Error(`Bad April income fixture line: ${line}`);
    const [, dd, name, amtStr, label] = m;
    const expectedKind = INCOME_LABEL_TO_KIND[label.trim()];
    if (!expectedKind) throw new Error(`Unknown income label: ${label}`);
    rows.push({
      date: `2026-04-${dd}`,
      name: name.trim(),
      amount: Number(amtStr.replace(/,/g, "")),
      expectedKind,
    });
  }
  return rows;
}
