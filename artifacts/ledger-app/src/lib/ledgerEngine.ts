import { detectIncomeCategory, getCategoryForTransaction, isKnownExpenseMerchant } from "./rulesEngine";
import type { IncomeCategory, Transaction, TransactionCategory, TransactionType } from "./types";

export interface FinalLedgerTransaction extends Transaction {
  originalType?: TransactionType;
  originalCategory?: string;
  categoryReason: string;
  typeReason: string;
  duplicateReason?: string;
  billMatchReason?: string;
}

export interface ExcludedLedgerTransaction extends Transaction {
  duplicateReason: string;
}

export interface FinalLedgerResult {
  finalRows: FinalLedgerTransaction[];
  excludedRows: ExcludedLedgerTransaction[];
  suspectedDuplicateRows: Transaction[];
}

export interface LedgerTotals {
  income: number;
  spending: number;
  net: number;
  earnedIncome: number;
  refundReversalIn: number;
  transferIn: number;
  otherMoneyIn: number;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeLedgerMerchant(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\boklahoma\s+(motor|mot|auto|credit)\b/g, "oklahoma motor")
    .replace(/\b(get\s*flex|flex\s*finance|getflex)\b/g, "flex finance")
    .replace(/\bamazon\s*prime\b|\bprime\s*membership\b/g, "amazon prime")
    .replace(/\bsynchrony\b|\bcare\s*credit\b/g, "carecredit synchrony")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLedgerDate(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const slash = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!slash) return date;
  const [, mm, dd, yy] = slash;
  const year = yy.length === 2 ? `20${yy}` : yy;
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function isIncomeMerchant(name: string): boolean {
  return /payroll|salary|hobby lobby payroll|gd-amazon|amazon transfer|amazon flex|flex pay|shipt pay|refund|return|reversal|cash transfer|transfer from|money transfer in|james bly|progressive refund|google one return|netflix reversal/i.test(
    name,
  );
}

function classifyFinalType(tx: Transaction): { type: TransactionType; reason: string } {
  if (isKnownExpenseMerchant(tx.name, tx.amount)) {
    return { type: "expense", reason: "known_expense_merchant" };
  }
  if (isIncomeMerchant(tx.name)) {
    return { type: "income", reason: "income_merchant_rule" };
  }
  if (tx.type === "income") {
    return { type: "income", reason: "stored_income_type" };
  }
  return { type: "expense", reason: tx.type === "expense" ? "stored_expense_type" : "default_expense" };
}

function classifyFinalCategory(tx: Transaction, type: TransactionType): { category: TransactionCategory | string; reason: string } {
  if (type === "income") return { category: "Uncategorized", reason: "income_has_no_expense_category" };
  const resolved = getCategoryForTransaction({ name: tx.name, amount: Math.abs(tx.amount) }, []).category;
  if (resolved !== "Uncategorized") return { category: resolved, reason: "rules_engine" };
  return { category: tx.category || "Uncategorized", reason: "stored_category_fallback" };
}

function duplicateKey(tx: FinalLedgerTransaction): string {
  const memo = normalizeLedgerMerchant(tx.note || "").slice(0, 60);
  return [
    normalizeLedgerDate(tx.date),
    normalizeLedgerMerchant(tx.name),
    Math.abs(tx.amount).toFixed(2),
    tx.type || "expense",
    memo,
  ].join("|");
}

export function getFinalLedgerResult(transactions: Transaction[]): FinalLedgerResult {
  const normalized = transactions
    .filter((tx) => isActiveRow(tx) && !tx.splitFrom)
    .map((tx): FinalLedgerTransaction => {
      const finalType = classifyFinalType(tx);
      const finalCategory = classifyFinalCategory(tx, finalType.type);
      const incomeCategory: IncomeCategory | undefined =
        finalType.type === "income" ? tx.incomeCategory ?? detectIncomeCategory(tx.name) : undefined;

      return {
        ...tx,
        date: normalizeLedgerDate(tx.date),
        amount: Math.abs(tx.amount),
        type: finalType.type,
        category: finalCategory.category,
        incomeCategory,
        isDuplicate: false,
        originalType: tx.type,
        originalCategory: tx.category,
        typeReason: finalType.reason,
        categoryReason: finalCategory.reason,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const seen = new Map<string, FinalLedgerTransaction>();
  const finalRows: FinalLedgerTransaction[] = [];
  const excludedRows: ExcludedLedgerTransaction[] = [];

  for (const row of normalized) {
    const key = duplicateKey(row);
    const first = seen.get(key);
    if (first) {
      excludedRows.push({
        ...row,
        isDuplicate: true,
        duplicateReason: `exact_duplicate:${first.id}`,
      });
      continue;
    }
    seen.set(key, row);
    finalRows.push(row);
  }

  return { finalRows, excludedRows, suspectedDuplicateRows: [] };
}

export function getFinalLedgerTransactions(transactions: Transaction[]): FinalLedgerTransaction[] {
  return getFinalLedgerResult(transactions).finalRows;
}

export function getLedgerTotals(finalRows: Transaction[]): LedgerTotals {
  let income = 0;
  let spending = 0;
  let earnedIncome = 0;
  let refundReversalIn = 0;
  let transferIn = 0;
  let otherMoneyIn = 0;

  for (const row of finalRows) {
    const amount = Math.abs(row.amount);
    if (row.type === "income") {
      income += amount;
      const name = normalizeLedgerMerchant(row.name);
      const cat = row.incomeCategory ?? detectIncomeCategory(row.name);
      if (/refund|return|reversal|rebate|cash back/.test(name)) refundReversalIn += amount;
      else if (/transfer from|money transfer in|cash transfer|james bly/.test(name) || cat === "Cash Transfer") transferIn += amount;
      else if (cat === "Payroll" || cat === "Gig Work" || cat === "Side Business" || /gd amazon|amazon transfer|shipt pay|payroll/.test(name)) {
        earnedIncome += amount;
      } else {
        otherMoneyIn += amount;
      }
    } else {
      spending += amount;
    }
  }

  income = roundCents(income);
  spending = roundCents(spending);
  return {
    income,
    spending,
    net: roundCents(income - spending),
    earnedIncome: roundCents(earnedIncome),
    refundReversalIn: roundCents(refundReversalIn),
    transferIn: roundCents(transferIn),
    otherMoneyIn: roundCents(otherMoneyIn),
  };
}

export function getCategoryTotals(finalRows: Transaction[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of finalRows) {
    if (row.type === "income") continue;
    const category = row.category || "Uncategorized";
    totals[category] = roundCents((totals[category] ?? 0) + Math.abs(row.amount));
  }
  return totals;
}

export function getIncomeTotals(finalRows: Transaction[]): Record<string, number> {
  const totals: Record<string, number> = {
    Payroll: 0,
    "Gig Work": 0,
    "Cash Transfer": 0,
    "Side Business": 0,
    "Other Income": 0,
  };
  for (const row of finalRows) {
    if (row.type !== "income") continue;
    const key = row.incomeCategory ?? detectIncomeCategory(row.name);
    totals[key] = roundCents((totals[key] ?? 0) + Math.abs(row.amount));
  }
  return totals;
}

export function getIncomeDepositRows(finalRows: Transaction[]): Transaction[] {
  return finalRows.filter((row) => row.type === "income" && !isKnownExpenseMerchant(row.name, row.amount));
}

export interface LedgerDiagnostics {
  rawCount: number;
  activeCount: number;
  finalCount: number;
  excludedCount: number;
  incomeCount: number;
  expenseCount: number;
  rawIncome: number;
  rawSpending: number;
  finalIncome: number;
  finalSpending: number;
  reclassifiedTypeCount: number;
  reclassifiedCategoryCount: number;
  statusBreakdown: Record<string, number>;
  typeBreakdown: Record<string, number>;
  topReclassifications: Array<{ id: string; name: string; amount: number; from: string; to: string; reason: string }>;
  droppedRows: Array<{ id: string; name: string; amount: number; date: string; reason: string }>;
}

export function getLedgerDiagnostics(transactions: Transaction[]): LedgerDiagnostics {
  const result = getFinalLedgerResult(transactions);
  const active = transactions.filter((tx) => isActiveRow(tx) && !tx.splitFrom);
  const totals = getLedgerTotals(result.finalRows);
  const rawIncome = transactions.filter((t) => t.type === "income").reduce((s, t) => s + Math.abs(t.amount), 0);
  const rawSpending = transactions.filter((t) => !t.type || t.type === "expense").reduce((s, t) => s + Math.abs(t.amount), 0);

  const reclassifiedType = result.finalRows.filter(
    (r) => r.typeReason !== "stored_income_type" && r.typeReason !== "stored_expense_type" && r.typeReason !== "default_expense",
  );
  const reclassifiedCategory = result.finalRows.filter(
    (r) => r.type === "expense" && r.categoryReason === "rules_engine" && r.originalCategory && r.originalCategory !== r.category,
  );

  return {
    rawCount: transactions.length,
    activeCount: active.length,
    finalCount: result.finalRows.length,
    excludedCount: result.excludedRows.length,
    incomeCount: result.finalRows.filter((r) => r.type === "income").length,
    expenseCount: result.finalRows.filter((r) => r.type === "expense").length,
    rawIncome: Math.round(rawIncome * 100) / 100,
    rawSpending: Math.round(rawSpending * 100) / 100,
    finalIncome: totals.income,
    finalSpending: totals.spending,
    reclassifiedTypeCount: reclassifiedType.length,
    reclassifiedCategoryCount: reclassifiedCategory.length,
    statusBreakdown: transactions.reduce<Record<string, number>>((acc, tx) => {
      const s = tx.status || "undefined";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {}),
    typeBreakdown: transactions.reduce<Record<string, number>>((acc, tx) => {
      const t = tx.type || "expense";
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {}),
    topReclassifications: reclassifiedType.slice(0, 10).map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      from: (r.originalType ?? "expense") as string,
      to: (r.type ?? "expense") as string,
      reason: r.typeReason,
    })),
    droppedRows: result.excludedRows.slice(0, 20).map((r) => ({
      id: r.id,
      name: r.name,
      amount: Math.abs(r.amount),
      date: r.date,
      reason: r.duplicateReason,
    })),
  };
}

function isActiveRow(tx: Transaction): boolean {
  return tx.status === "cleared" || tx.status === "pending" || tx.status === "review";
}
