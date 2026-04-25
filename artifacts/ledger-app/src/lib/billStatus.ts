import {
  getCategoryTotals,
  getFinalLedgerResult,
  getFinalLedgerTransactions,
  getIncomeDepositRows,
  getLedgerTotals,
} from "./ledgerEngine";
import type { Bill, Transaction } from "./types";

const DUPLICATE_DAY_WINDOW = 7;

function transactionDateBelongsToMonth(date: string, monthKey: string): boolean {
  if (date.startsWith(monthKey)) return true;
  const [year, month] = monthKey.split("-");
  const slash = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!slash) return false;
  const [, mm, , yy] = slash;
  const fullYear = yy.length === 2 ? `20${yy}` : yy;
  return fullYear === year && mm.padStart(2, "0") === month;
}

/** Prefer calendar dates over stored month, while supporting both ISO and bank-export date formats. */
export function filterTransactionsToCalendarMonth(transactions: Transaction[], monthKey: string): Transaction[] {
  const byCalendarDate = transactions.filter((t) => transactionDateBelongsToMonth(t.date, monthKey));
  if (byCalendarDate.length > 0) return byCalendarDate;
  return transactions.filter((t) => t.month === monthKey);
}


export function normalizeMerchant(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases: Array<[RegExp, string]> = [
    [/(oklahoma\s+(motor|mot|auto|credit))/g, "oklahoma motor"],
    [/(get\s*flex|flex\s*finance|getflex)/g, "flex finance"],
    [/(planet\s*fitness|planet\s*f)/g, "planet fitness"],
    [/(amazon\s*prime|prime\s*membership|flexible\s*finance\s*14\s*99)/g, "amazon prime"],
    [/(pike\s*pass|pikepass)/g, "pikepass"],
    [/(cox(\s+oklahoma)?)/g, "cox"],
    [/(care\s*credit|synchrony)/g, "carecredit synchrony"],
    [/(village\s*lane|low\s*t)/g, "village lane"],
  ];
  let canonical = normalized;
  for (const [pattern, replacement] of aliases) canonical = canonical.replace(pattern, replacement);
  return canonical.replace(/\s+/g, " ").trim();
}

function merchantTokens(value: string): string[] {
  return normalizeMerchant(value)
    .split(" ")
    .filter((t) => t.length >= 3)
    .filter((t) => !["inc", "llc", "co", "payment", "purchase", "debit", "card"].includes(t));
}

function merchantSignature(value: string): string {
  const tokens = merchantTokens(value);
  return tokens.slice(0, 3).join(" ");
}

function merchantsLikelySame(a: string, b: string): boolean {
  const sigA = merchantSignature(a);
  const sigB = merchantSignature(b);
  if (!sigA || !sigB) return false;
  if (sigA === sigB || sigA.includes(sigB) || sigB.includes(sigA)) return true;
  const aTokens = new Set(merchantTokens(a));
  const bTokens = merchantTokens(b);
  const overlap = bTokens.filter((t) => aTokens.has(t)).length;
  return overlap >= 2;
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

function isExpense(tx: Transaction): boolean {
  return !tx.type || tx.type === "expense";
}

export function isPostedExpense(tx: Transaction): boolean {
  return isExpense(tx) && tx.status === "cleared";
}

/** Cleared or pending expenses count toward cash-flow spending (user rule: pending is real). */
export function isLedgerCountingExpense(tx: Transaction): boolean {
  return isExpense(tx) && (tx.status === "cleared" || tx.status === "pending" || tx.status === "review") && !tx.splitFrom;
}

function txDupKey(tx: Transaction): string {
  return `${merchantSignature(tx.name)}|${Math.abs(tx.amount).toFixed(2)}`;
}

export interface DuplicateCluster {
  id: string;
  transactions: Transaction[];
  suggestedDeleteIds: string[];
}

function memoFingerprint(tx: Transaction): string {
  return normalizeMerchant((tx.note || "").trim());
}

/**
 * True duplicate import: same posting date + normalized merchant + amount + memo fingerprint
 * (so two real payments same day/merchant/amount but different card/memo stay separate).
 */
export function detectStrictExpenseDuplicateClusters(transactions: Transaction[]): DuplicateCluster[] {
  const candidates = transactions
    .filter((tx) => isLedgerCountingExpense(tx) && !tx.splitFrom)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const buckets = new Map<string, Transaction[]>();
  for (const tx of candidates) {
    const memo = memoFingerprint(tx).slice(0, 40);
    const key = `${tx.date}|${normalizeMerchant(tx.name)}|${Math.abs(tx.amount).toFixed(2)}|${memo}`;
    const arr = buckets.get(key) ?? [];
    arr.push(tx);
    buckets.set(key, arr);
  }
  const clusters: DuplicateCluster[] = [];
  for (const [, txs] of buckets) {
    if (txs.length < 2) continue;
    const sorted = [...txs].sort((a, b) => a.id.localeCompare(b.id));
    clusters.push({
      id: `strict_exp:${sorted[0].id}`,
      transactions: sorted,
      suggestedDeleteIds: sorted.slice(1).map((t) => t.id),
    });
  }
  return clusters;
}

/** Same-calendar-date + same merchant + same amount + memo fingerprint (income double-post). */
export function detectStrictDuplicateIncomeIds(transactions: Transaction[]): Set<string> {
  const candidates = transactions
    .filter((tx) => tx.type === "income" && (tx.status === "cleared" || tx.status === "pending") && !tx.isDuplicate && !tx.splitFrom)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const buckets = new Map<string, Transaction[]>();
  for (const tx of candidates) {
    const memo = memoFingerprint(tx).slice(0, 40);
    const key = `${tx.date}|${normalizeMerchant(tx.name)}|${Math.abs(tx.amount).toFixed(2)}|${memo}`;
    const arr = buckets.get(key) ?? [];
    arr.push(tx);
    buckets.set(key, arr);
  }
  const deleteIds = new Set<string>();
  for (const [, txs] of buckets) {
    if (txs.length < 2) continue;
    const sorted = [...txs].sort((a, b) => a.id.localeCompare(b.id));
    sorted.slice(1).forEach((t) => deleteIds.add(t.id));
  }
  return deleteIds;
}

/** Soft duplicate signal for review UI only — not auto-excluded from totals. */
export function detectSuspectedExpenseDuplicateClusters(transactions: Transaction[]): DuplicateCluster[] {
  const candidates = transactions
    .filter((tx) => isLedgerCountingExpense(tx) && !tx.splitFrom)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const clusters: DuplicateCluster[] = [];
  for (const tx of candidates) {
    let matched = false;
    for (const cluster of clusters) {
      const base = cluster.transactions[0];
      const sameAmount = Math.abs(Math.abs(base.amount) - Math.abs(tx.amount)) <= 0.009;
      const closeDate = dayDiff(base.date, tx.date) <= DUPLICATE_DAY_WINDOW;
      const sameMerchant = merchantsLikelySame(base.name, tx.name);
      if (sameAmount && closeDate && sameMerchant) {
        cluster.transactions.push(tx);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({
        id: `${tx.id}:${txDupKey(tx)}`,
        transactions: [tx],
        suggestedDeleteIds: [],
      });
    }
  }
  return clusters
    .map((cluster) => {
      const sorted = [...cluster.transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      return { ...cluster, transactions: sorted, suggestedDeleteIds: sorted.slice(1).map((t) => t.id) };
    })
    .filter((cluster) => cluster.transactions.length > 1);
}

/** @deprecated name — use detectSuspectedExpenseDuplicateClusters; kept for ledger duplicate scan UI. */
export const detectLikelyDuplicates = detectSuspectedExpenseDuplicateClusters;

export function dedupePostedBillTransactions(transactions: Transaction[]): Transaction[] {
  const dupDeleteSet = new Set(detectStrictExpenseDuplicateClusters(transactions).flatMap((c) => c.suggestedDeleteIds));
  return transactions
    .filter((tx) => isLedgerCountingExpense(tx) && !tx.splitFrom && !dupDeleteSet.has(tx.id))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function detectLikelyDuplicateIncomeIds(transactions: Transaction[]): Set<string> {
  return detectStrictDuplicateIncomeIds(transactions);
}

export function isReportableExpense(tx: Transaction): boolean {
  return isLedgerCountingExpense(tx);
}

/**
 * Bank/credit rows that are credits (refunds) but stored as expenses — count toward Money In, not spending.
 * Supports positive "credit" amounts or negative amounts labeled refund depending on import convention.
 */
export function isRefundLikeCreditExpense(tx: Transaction): boolean {
  if (tx.type === "income") return false;
  if (!isLedgerCountingExpense(tx)) return false;
  const n = normalizeMerchant(tx.name);
  if (!/refund|return|rebate|reversal|credit voucher|cash\s*back|chargeback credit|purchase credit/i.test(n)) return false;
  if (tx.amount > 0.004) return true;
  if (tx.amount < -0.004) return true;
  return false;
}

function findManualBillShadowedByImportIds(transactions: Transaction[]): Set<string> {
  const expenses = transactions.filter((t) => isLedgerCountingExpense(t));
  const imported = expenses.filter((t) => {
    const s = t.source;
    return !s || s === "imported_bank_transaction" || s === "posted_transaction" || s === "pending_transaction";
  });
  const manual = expenses.filter((t) => t.source === "manual_bill" || t.source === "linked_bill");
  const drop = new Set<string>();
  for (const m of manual) {
    const hit = imported.find(
      (i) =>
        i.id !== m.id &&
        i.date === m.date &&
        Math.abs(Math.abs(i.amount) - Math.abs(m.amount)) <= 0.02 &&
        (merchantsLikelySame(i.name, m.name) || (!!m.billId && i.billId === m.billId)),
    );
    if (hit) drop.add(m.id);
  }
  return drop;
}

/** Income rows that count toward cash-flow money-in (includes transfers/refunds; strict same-day dupes removed elsewhere). */
export function isReportableIncome(tx: Transaction): boolean {
  return tx.type === "income" && (tx.status === "cleared" || tx.status === "pending" || tx.status === "review") && !tx.splitFrom;
}

export function isTrueIncomeDeposit(tx: Transaction): boolean {
  return getIncomeDepositRows(getFinalLedgerTransactions([tx])).length > 0;
}

export type MoneyInKind = "earned" | "refund_reversal" | "internal_transfer" | "other";

export function classifyMoneyInKind(tx: Transaction): MoneyInKind {
  if (tx.type !== "income") return "other";
  const n = normalizeMerchant(tx.name);
  const cat = tx.incomeCategory;

  if (
    /refund|\.com refund|purchase return|rebate|cash back|return from|walmart.*refund|refund.*walmart|walmart com return|amazon purchase return|amazon return|progressive refund|google one return|return item/i.test(
      n,
    )
  )
    return "refund_reversal";
  if (/\breversal\b|fee reversal|charge reversed/i.test(n) && !/ach withdrawal reversal|debit card reversal|posted debit/i.test(n)) return "refund_reversal";

  if (
    /transfer from|money transfer in|internal transfer|between accounts|xfer from|zelle payment from|zelle from|from savings|from checking|to savings|to checking|account to account|james bly|\bcash transfer\b/i.test(
      n,
    )
  )
    return "internal_transfer";
  if (cat === "Cash Transfer") return "internal_transfer";

  if (cat === "Payroll" || cat === "Gig Work" || cat === "Side Business") return "earned";
  if (/hobby lobby|shipt pay|shipt|direct dep|payroll|salary|adp|gusto|employer|1099/i.test(n)) return "earned";
  if (/gd-amazon|amzn|amazon flex|flex pay|amazon transfer|gig|payout|amazon\.com.*credit|amazon marketplace/i.test(n)) return "earned";

  return "other";
}

export interface MonthAuditOptions {
  /** Recurring-category keys (e.g. "car", "rent") where user allowed extra charges this month — those txs stay in audited totals. */
  recurringOverageAllowedKeys?: Set<string>;
}

export function computeBillManagerMonthTotals(
  bills: Bill[],
  month: string,
  monthTransactions: Transaction[],
  auditOptions?: MonthAuditOptions,
): { totalAmount: number; paidAmount: number; remainingAmount: number } {
  const rec = computeBillManagerReconciliation(bills, month, monthTransactions, auditOptions);
  return { totalAmount: rec.totalAmount, paidAmount: rec.paidAmount, remainingAmount: rec.remainingAmount };
}

export interface BillManagerReconciliation {
  cleanTransactions: Transaction[];
  cleanBillTransactions: Transaction[];
  matchedBillIds: string[];
  unmatchedBills: Bill[];
  warning: boolean;
  dashboardSpending: number;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
  billStatuses: Array<{
    id: string;
    label: string;
    mode: BillPaymentMode;
    expectedAmount: number;
    paidAmount: number;
    status: "PAID" | "UNDERPAID" | "UNMATCHED";
  }>;
}

type BillPaymentMode = "SINGLE" | "SUM_REQUIRED";

function getBillPaymentMode(name: string): BillPaymentMode {
  const n = normalizeMerchant(name);
  if (
    /affirm|carecredit|synchrony|rent|flex finance|oklahoma motor|car|auto|payment thank|thank you for payment|wells fargo.*card|capital one|citi card|discover|credit card payment|cardmember|chase card|amex|american express/.test(
      n,
    )
  )
    return "SUM_REQUIRED";
  return "SINGLE";
}

export function computeBillManagerReconciliation(
  bills: Bill[],
  month: string,
  monthTransactions: Transaction[],
  auditOptions?: MonthAuditOptions,
): BillManagerReconciliation {
  const monthBills = billsForBillManagerMonth(bills, month);
  const grouped = new Map<string, Bill[]>();
  for (const bill of monthBills) {
    const key = `${merchantSignature(bill.name)}|${Math.abs(bill.amount).toFixed(2)}`;
    const arr = grouped.get(key) ?? [];
    arr.push(bill);
    grouped.set(key, arr);
  }
  const dedupedBills = Array.from(grouped.values()).flatMap((group) => {
    const sorted = [...group].sort((a, b) => a.dueDay - b.dueDay);
    const name = normalizeMerchant(sorted[0].name);
    let maxCount = 2;
    if (/planet fitness|pikepass|cox|amazon prime|progressive|village lane|carecredit|synchrony/.test(name)) maxCount = 1;
    return sorted.slice(0, maxCount);
  });
  const cleanTransactions = filterAuditedTransactions(monthTransactions, auditOptions);
  const billCandidates = dedupePostedBillTransactions(cleanTransactions)
    .filter((tx) => (!tx.type || tx.type === "expense") && (getAuditedExpenseCategory(tx) === "Bills" || !!tx.billId));
  const usedTxIds = new Set<string>();
  const matchedBillIds = new Set<string>();
  const unmatchedBills: Bill[] = [];
  const billStatuses: BillManagerReconciliation["billStatuses"] = [];
  let paidAmount = 0;
  let remainingAmount = 0;

  const policyGroups = new Map<string, Bill[]>();
  for (const bill of dedupedBills) {
    const policyKey = `${merchantSignature(bill.name)}|${getBillPaymentMode(bill.name)}`;
    const arr = policyGroups.get(policyKey) ?? [];
    arr.push(bill);
    policyGroups.set(policyKey, arr);
  }

  const scoreCandidate = (tx: Transaction, bill: Bill): number => {
    const sameMerchant = merchantsLikelySame(tx.name, bill.name);
    const exactAmount = Math.abs(Math.abs(tx.amount) - bill.amount) <= 0.01;
    const closeAmount = Math.abs(Math.abs(tx.amount) - bill.amount) <= 1;
    const day = parseInt(tx.date.split("-")[2] ?? "", 10);
    const closeDate = !Number.isNaN(day) && Math.abs(day - bill.dueDay) <= 7;
    if (sameMerchant && exactAmount) return 3;
    if (sameMerchant && closeAmount) return 2;
    if (closeDate) return 1;
    return 0;
  };

  const maxGroupMatchScore = (group: Bill[]): number => {
    const head = group[0];
    let best = 0;
    for (const tx of billCandidates) {
      const s = scoreCandidate(tx, head);
      if (s > best) best = s;
    }
    return best;
  };

  const groupList = Array.from(policyGroups.values()).sort((a, b) => {
    const sa = maxGroupMatchScore(a);
    const sb = maxGroupMatchScore(b);
    if (sa !== sb) return sb - sa;
    return a[0].dueDay - b[0].dueDay;
  });

  for (const groupBills of groupList) {
    const sortedBills = [...groupBills].sort((a, b) => a.dueDay - b.dueDay);
    const mode = getBillPaymentMode(sortedBills[0].name);
    const expectedAmount = sortedBills.reduce((s, b) => s + b.amount, 0);
    const merchant = sortedBills[0].name;
    const pool = billCandidates.filter((tx) => {
      if (usedTxIds.has(tx.id)) return false;
      return sortedBills.some((b) => scoreCandidate(tx, b) > 0);
    });
    const headBill = sortedBills[0];
    const candidates = [...pool].sort((a, b) => {
      const aScore = scoreCandidate(a, headBill);
      const bScore = scoreCandidate(b, headBill);
      if (aScore !== bScore) return bScore - aScore;
      if (mode === "SUM_REQUIRED") {
        return Math.abs(b.amount) - Math.abs(a.amount);
      }
      return a.date.localeCompare(b.date);
    });

    if (mode === "SUM_REQUIRED") {
      let totalPaid = 0;
      const cap = expectedAmount + 0.01;
      for (const tx of candidates) {
        if (totalPaid >= expectedAmount - 0.01) break;
        const amt = Math.abs(tx.amount);
        if (totalPaid + amt > cap) continue;
        totalPaid += amt;
        usedTxIds.add(tx.id);
      }
      paidAmount += totalPaid;
      let remaining = Math.max(0, expectedAmount - totalPaid);
      remainingAmount += remaining;
      if (totalPaid > 0) {
        let budget = totalPaid;
        for (const b of sortedBills) {
          if (budget <= 0.01) break;
          matchedBillIds.add(b.id);
          budget -= b.amount;
        }
      }
      if (remaining > 0) {
        for (const b of sortedBills) {
          if (remaining <= 0.01) break;
          if (matchedBillIds.has(b.id)) continue;
          unmatchedBills.push(b);
          remaining -= b.amount;
        }
      }
      billStatuses.push({
        id: `group:${merchantSignature(merchant)}:${mode}`,
        label: sortedBills.map((b) => b.name).join(", "),
        mode,
        expectedAmount,
        paidAmount: totalPaid,
        status: totalPaid >= expectedAmount ? "PAID" : totalPaid > 0 ? "UNDERPAID" : "UNMATCHED",
      });
      continue;
    }

    const best = candidates
      .sort((a, b) => {
        const amountDelta = Math.abs(Math.abs(a.amount) - sortedBills[0].amount) - Math.abs(Math.abs(b.amount) - sortedBills[0].amount);
        if (amountDelta !== 0) return amountDelta;
        return a.date.localeCompare(b.date);
      })[0];
    if (best) {
      usedTxIds.add(best.id);
      paidAmount += Math.abs(best.amount);
      sortedBills.forEach((b) => matchedBillIds.add(b.id));
      billStatuses.push({
        id: `group:${merchantSignature(merchant)}:${mode}`,
        label: sortedBills.map((b) => b.name).join(", "),
        mode,
        expectedAmount,
        paidAmount: Math.abs(best.amount),
        status: "PAID",
      });
    } else {
      sortedBills.forEach((b) => {
        if (!isPaidInMonth(b, month)) {
          unmatchedBills.push(b);
          remainingAmount += b.amount;
        }
      });
      billStatuses.push({
        id: `group:${merchantSignature(merchant)}:${mode}`,
        label: sortedBills.map((b) => b.name).join(", "),
        mode,
        expectedAmount,
        paidAmount: 0,
        status: "UNMATCHED",
      });
    }
  }

  // If a bill was manually marked paid but no clean ledger match exists, keep it as paid.
  const manualPaidUnlinked = dedupedBills
    .filter((b) => isPaidInMonth(b, month) && !matchedBillIds.has(b.id) && !findLinkedTransaction(b, cleanTransactions))
    .reduce((s, b) => s + b.amount, 0);
  paidAmount += manualPaidUnlinked;
  remainingAmount = Math.max(0, remainingAmount - manualPaidUnlinked);

  const cleanBillTransactions = billCandidates.filter((tx) => usedTxIds.has(tx.id));
  const totalAmount = paidAmount + remainingAmount;
  const { spending: dashboardSpending } = computeAuditedMonthTotals(monthTransactions, auditOptions);
  return {
    cleanTransactions,
    cleanBillTransactions,
    matchedBillIds: Array.from(matchedBillIds),
    unmatchedBills,
    warning: unmatchedBills.length > 0,
    dashboardSpending,
    paidAmount,
    remainingAmount,
    totalAmount,
    billStatuses,
  };
}

export interface MonthAuditReport {
  rawIncome: number;
  auditedIncome: number;
  rawSpending: number;
  auditedSpending: number;
  categoryTotalsAudited: Record<string, number>;
  manualBillMergedIds: string[];
  excludedPendingCount: number;
  excludedDuplicateCount: number;
  excludedSplitCount: number;
  duplicateGroupCount: number;
  strictDuplicateExpenseIds: string[];
  suspectedDuplicateExpenseIds: string[];
  duplicateCandidateIds: string[];
  duplicateIncomeCandidateIds: string[];
  overcountedBills: string[];
  manualImportedConflicts: string[];
  recurringOverages: string[];
  recurringOverageRows: Array<{ key: string; txIds: string[] }>;
  splitComponentIds: string[];
  confirmedDuplicateAmountRemoved: number;
  excludedRows: Array<{ id: string; reason: string; name: string; amount: number; date: string }>;
}

export interface AuditTargetResult {
  key: string;
  label: string;
  expected: number | null;
  actual: number;
  passed: boolean;
}

export interface AuditTargetsReport {
  month: string;
  baselineSpending: number;
  expectedReduction: number;
  projectedSpending: number;
  actualAuditedSpending: number;
  targets: AuditTargetResult[];
}

function sumByRules(
  txs: Transaction[],
  rules: Array<{ merchant?: RegExp; date?: RegExp; amount?: number }>,
): number {
  return txs
    .filter((tx) => rules.some((rule) => {
      const name = normalizeMerchant(tx.name);
      const merchantOk = !rule.merchant || rule.merchant.test(name);
      const dateOk = !rule.date || rule.date.test(tx.date);
      const amountOk = rule.amount === undefined || Math.abs(Math.abs(tx.amount) - rule.amount) <= 0.01;
      return merchantOk && dateOk && amountOk;
    }))
    .reduce((s, tx) => s + Math.abs(tx.amount), 0);
}

/** Manual Wells Fargo audit (April 1–24, 2026) — validation only; totals are not applied to the ledger. */
export const APRIL_2026_MANUAL_AUDIT = {
  moneyIn: 4462.46,
  spending: 4880.32,
  net: -417.86,
  categories: {
    Bills: 3356.62,
    Fuel: 357.83,
    Necessary: 300.65,
    Medical: 145.02,
    Shopping: 231.8,
    Transfers: 67.0,
    Work: 85.0,
    Waste: 96.74,
    Personal: 239.66,
  },
} as const;

export function getAuditedExpenseCategory(tx: Transaction): string {
  const final = getFinalLedgerTransactions([tx])[0];
  return final?.category || tx.category || "Uncategorized";
}

export function verifyKnownTargets(
  month: string,
  transactions: Transaction[],
  options?: MonthAuditOptions,
): AuditTargetsReport | null {
  if (month !== "2026-04") return null;
  const scoped = filterTransactionsToCalendarMonth(transactions, month);
  const cat = computeAuditedCategoryTotals(scoped, options);
  const { income: moneyIn, spending } = computeAuditedMonthTotals(scoped, options);
  const manual = APRIL_2026_MANUAL_AUDIT;
  const targets: AuditTargetResult[] = [
    { key: "money_in", label: "Money In (manual audit)", expected: manual.moneyIn, actual: moneyIn, passed: false },
    { key: "spending", label: "Money Out / spending (manual audit)", expected: manual.spending, actual: spending, passed: false },
    {
      key: "net",
      label: "Net cash flow (manual audit)",
      expected: manual.net,
      actual: moneyIn - spending,
      passed: false,
    },
    ...Object.entries(manual.categories).map(([key, expected]) => ({
      key: `cat_${key}`,
      label: `Category: ${key} (manual audit)`,
      expected,
      actual: cat[key] ?? 0,
      passed: false,
    })),
  ];
  targets.forEach((t) => {
    if (t.expected === null) t.passed = true;
    else t.passed = Math.abs(t.actual - t.expected) <= 0.55;
  });
  const baselineSpending = manual.spending;
  const expectedReduction = 0;
  return {
    month,
    baselineSpending,
    expectedReduction,
    projectedSpending: baselineSpending - expectedReduction,
    actualAuditedSpending: spending,
    targets,
  };
}

export function computeAuditedMonthTotals(
  transactions: Transaction[],
  options?: MonthAuditOptions,
): {
  income: number;
  spending: number;
  earnedIncome: number;
  refundReversalIn: number;
  transferIn: number;
  otherMoneyIn: number;
} {
  const totals = getLedgerTotals(getFinalLedgerTransactions(transactions));
  return {
    income: totals.income,
    spending: totals.spending,
    earnedIncome: totals.earnedIncome,
    refundReversalIn: totals.refundReversalIn,
    transferIn: totals.transferIn,
    otherMoneyIn: totals.otherMoneyIn,
  };
}

export function filterAuditedTransactions(transactions: Transaction[], options?: MonthAuditOptions): Transaction[] {
  return getFinalLedgerTransactions(transactions);
}

export function getCleanLedgerTransactions(transactions: Transaction[], options?: MonthAuditOptions): Transaction[] {
  return filterAuditedTransactions(transactions, options);
}

/** Spending-only category totals from the same clean rules as dashboard (refund-like credits excluded). */
export function computeAuditedCategoryTotals(transactions: Transaction[], options?: MonthAuditOptions): Record<string, number> {
  return getCategoryTotals(getFinalLedgerTransactions(transactions));
}

function merchantKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildMonthAuditReport(transactions: Transaction[], options?: MonthAuditOptions): MonthAuditReport {
  {
    const finalResult = getFinalLedgerResult(transactions);
    const finalRows = finalResult.finalRows;
    const finalTotals = getLedgerTotals(finalRows);
    const expenses = transactions.filter((t) => !t.type || t.type === "expense");
    const income = transactions.filter((t) => t.type === "income");
    const rawSpending = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
    const rawIncome = income.reduce((s, t) => s + Math.abs(t.amount), 0);
    const excludedRows = finalResult.excludedRows.map((tx) => ({
      id: tx.id,
      reason: tx.duplicateReason,
      name: tx.name,
      amount: Math.abs(tx.amount),
      date: tx.date,
    }));

    return {
      rawIncome,
      auditedIncome: finalTotals.income,
      rawSpending,
      auditedSpending: finalTotals.spending,
      categoryTotalsAudited: getCategoryTotals(finalRows),
      manualBillMergedIds: [],
      excludedPendingCount: 0,
      excludedDuplicateCount: excludedRows.length,
      excludedSplitCount: transactions.filter((t) => !!t.splitFrom).length,
      duplicateGroupCount: 0,
      strictDuplicateExpenseIds: excludedRows.map((row) => row.id),
      suspectedDuplicateExpenseIds: [],
      duplicateCandidateIds: excludedRows.map((row) => row.id),
      duplicateIncomeCandidateIds: [],
      overcountedBills: [],
      manualImportedConflicts: [],
      recurringOverages: [],
      recurringOverageRows: [],
      splitComponentIds: transactions.filter((t) => !!t.splitFrom).map((t) => t.id),
      confirmedDuplicateAmountRemoved: excludedRows.reduce((s, row) => s + row.amount, 0),
      excludedRows,
    };
  }

  const expenses = transactions.filter((t) => !t.type || t.type === "expense");
  const income = transactions.filter((t) => t.type === "income");
  const rawSpending = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const rawIncome = income.reduce((s, t) => s + Math.abs(t.amount), 0);
  const duplicateIncomeCandidateIds = Array.from(detectStrictDuplicateIncomeIds(transactions));
  const incomeDupSet = new Set(duplicateIncomeCandidateIds);
  const baseIncomeFromDeposits = income
    .filter((t) => isReportableIncome(t) && !incomeDupSet.has(t.id))
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const pendingInMonthCount = transactions.filter((t) => t.status === "pending").length;
  const excludedDuplicateCount = transactions.filter((t) => !!t.isDuplicate).length;
  const excludedSplitCount = transactions.filter((t) => !!t.splitFrom).length;

  const strictExpenseClusters = detectStrictExpenseDuplicateClusters(transactions);
  const duplicateCandidateIds = new Set(strictExpenseClusters.flatMap((c) => c.suggestedDeleteIds));
  const strictDuplicateExpenseIds = Array.from(duplicateCandidateIds);

  const suspectedClusters = detectSuspectedExpenseDuplicateClusters(transactions);
  const suspectedDuplicateExpenseIds = [
    ...new Set(suspectedClusters.flatMap((c) => c.suggestedDeleteIds)),
  ].filter((id) => !duplicateCandidateIds.has(id));

  const manualBillMergedIds = Array.from(findManualBillShadowedByImportIds(transactions));
  const manualMergedSet = new Set(manualBillMergedIds);

  const splitComponentIds = new Set<string>();
  const billsOnly = transactions.filter((t) => isReportableExpense(t) && getAuditedExpenseCategory(t) === "Bills");
  for (const parent of billsOnly) {
    const children = billsOnly.filter(
      (t) =>
        t.id !== parent.id &&
        t.date === parent.date &&
        Math.abs(t.amount) < Math.abs(parent.amount) &&
        merchantsLikelySame(t.name, parent.name),
    );
    if (children.length < 2) continue;
    const childSum = children.reduce((s, c) => s + Math.abs(c.amount), 0);
    if (Math.abs(Math.abs(parent.amount) - childSum) <= 2) {
      children.forEach((c) => splitComponentIds.add(c.id));
    }
  }

  const recurringLimits = [
    { key: "car", max: 4, test: (n: string, c: string) => c === "Bills" && /car|motor|auto|vehicle|oklahoma/.test(n) },
    { key: "rent", max: 4, test: (n: string, c: string) => c === "Bills" && /rent|flex|lease|apartment|getflex/.test(n) },
    { key: "insurance", max: 2, test: (n: string, c: string) => c === "Bills" && /insurance|progressive|geico|state farm/.test(n) },
    { key: "subscription", max: 4, test: (n: string, c: string) => c === "Bills" && /netflix|hulu|planet fitness|spotify|apple tv|youtube premium/.test(n) },
  ];
  const recurringOverages: string[] = [];
  const recurringOverageRows: Array<{ key: string; txIds: string[] }> = [];
  for (const limit of recurringLimits) {
    const matching = billsOnly.filter((t) => limit.test(normalizeMerchant(t.name), getAuditedExpenseCategory(t)));
    if (matching.length > limit.max) {
      recurringOverages.push(`${limit.key}: ${matching.length} (limit ${limit.max})`);
      recurringOverageRows.push({ key: limit.key, txIds: matching.slice(limit.max).map((tx) => tx.id) });
    }
  }

  const manualImportedConflicts = suspectedClusters
    .filter((c) => c.transactions.some((t) => t.source === "manual_bill") && c.transactions.some((t) => t.source === "imported_bank_transaction"))
    .map((c) => c.id);

  const overcountedBills = suspectedClusters
    .map((c) => c.transactions[0]?.name)
    .filter((n): n is string => !!n);

  const excludedRows: MonthAuditReport["excludedRows"] = [];
  transactions.forEach((tx) => {
    let reason: string | null = null;
    if (duplicateCandidateIds.has(tx.id)) reason = "exact_duplicate";
    else if (incomeDupSet.has(tx.id)) reason = "exact_duplicate";
    else if (manualMergedSet.has(tx.id)) reason = "manual_bill_matched_to_import";
    else if (splitComponentIds.has(tx.id)) reason = "split_component";
    else if (tx.isDuplicate) reason = "marked_duplicate";
    else if (tx.splitFrom) reason = "child_split_row";
    if (!reason) return;
    excludedRows.push({
      id: tx.id,
      reason,
      name: tx.name,
      amount: Math.abs(tx.amount),
      date: tx.date,
    });
  });
  const confirmedDuplicateAmountRemoved = excludedRows.reduce((s, row) => s + row.amount, 0);

  const passesExpenseAudit = (t: Transaction) =>
    isReportableExpense(t) &&
    !duplicateCandidateIds.has(t.id) &&
    !splitComponentIds.has(t.id) &&
    !manualMergedSet.has(t.id) &&
    !isRefundLikeCreditExpense(t);

  const refundExpenseInflowAudited = expenses
    .filter(
      (t) =>
        isReportableExpense(t) &&
        !duplicateCandidateIds.has(t.id) &&
        !splitComponentIds.has(t.id) &&
        !manualMergedSet.has(t.id) &&
        isRefundLikeCreditExpense(t),
    )
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const baseAuditedIncome = baseIncomeFromDeposits + refundExpenseInflowAudited;

  const categoryTotalsAudited: Record<string, number> = {};
  for (const t of expenses) {
    if (!passesExpenseAudit(t)) continue;
    const c = getAuditedExpenseCategory(t);
    categoryTotalsAudited[c] = (categoryTotalsAudited[c] ?? 0) + Math.abs(t.amount);
  }

  return {
    rawIncome,
    auditedIncome: baseAuditedIncome,
    rawSpending,
    auditedSpending: expenses.filter(passesExpenseAudit).reduce((s, t) => s + Math.abs(t.amount), 0),
    categoryTotalsAudited,
    manualBillMergedIds,
    excludedPendingCount: pendingInMonthCount,
    excludedDuplicateCount,
    excludedSplitCount,
    duplicateGroupCount: suspectedClusters.length,
    strictDuplicateExpenseIds,
    suspectedDuplicateExpenseIds,
    duplicateCandidateIds: Array.from(duplicateCandidateIds),
    duplicateIncomeCandidateIds,
    overcountedBills,
    manualImportedConflicts,
    recurringOverages,
    recurringOverageRows,
    splitComponentIds: Array.from(splitComponentIds),
    confirmedDuplicateAmountRemoved,
    excludedRows,
  };
}

export function findPotentialDuplicates(
  candidate: { name: string; amount: number; date: string; category?: string },
  transactions: Transaction[],
): Transaction[] {
  const merchant = normalizeMerchant(candidate.name);
  return transactions.filter((tx) => {
    if (!isLedgerCountingExpense(tx)) return false;
    if (Math.abs(Math.abs(tx.amount) - Math.abs(candidate.amount)) > 0.009) return false;
    if (dayDiff(tx.date, candidate.date) > DUPLICATE_DAY_WINDOW) return false;
    if (candidate.category && tx.category !== candidate.category) return false;
    return merchantsLikelySame(merchant, tx.name);
  });
}

/** Manual paid flag for a calendar month (recurring: paidMonths; one-time: isPaid). */
export function isPaidInMonth(bill: Bill, month: string): boolean {
  if (bill.paidMonths) return bill.paidMonths.includes(month);
  return bill.isPaid;
}

/**
 * Ledger row that counts as paying this bill for the month (explicit billId or fuzzy name match).
 * Mirrors Bill Manager so Dashboard / other views stay consistent.
 */
export function findLinkedTransaction(bill: Bill, transactions: Transaction[]): Transaction | undefined {
  const byId = transactions.find((tx) => tx.billId === bill.id && isLedgerCountingExpense(tx));
  if (byId) return byId;
  const billName = normalizeMerchant(bill.name);
  return transactions.find((tx) => {
    if (!isLedgerCountingExpense(tx)) return false;
    const sameMerchant = merchantsLikelySame(billName, tx.name);
    const similarAmount = Math.abs(Math.abs(tx.amount) - Math.abs(bill.amount)) <= 1;
    const day = parseInt(tx.date.split("-")[2] ?? "", 10);
    const closeDate = !Number.isNaN(day) && Math.abs(day - bill.dueDay) <= 7;
    return sameMerchant && similarAmount && closeDate;
  });
}

export function isEffectivelyPaidInMonth(
  bill: Bill,
  month: string,
  monthTransactions: Transaction[]
): boolean {
  if (isPaidInMonth(bill, month)) return true;
  return !!findLinkedTransaction(bill, monthTransactions);
}

/** Same bill list as Bill Manager when `selectedMonth` is the viewed month. */
export function billsForBillManagerMonth(bills: Bill[], month: string): Bill[] {
  const recurring = bills.filter((b) => b.isRecurring || !b.month || b.month !== month);
  const monthSpecific = bills.filter((b) => !b.isRecurring && b.month === month);
  return [...recurring, ...monthSpecific];
}
