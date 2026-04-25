import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDocsFromServer,
  getDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  setDoc,
  writeBatch,
  deleteField,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Bill, Month, Rule, Transaction, TransactionCategory } from "./types";
import { detectIncomeCategory, getCategoryForTransaction } from "./rulesEngine";
import { computeAuditedMonthTotals, filterTransactionsToCalendarMonth, getAuditedExpenseCategory } from "./billStatus";
import {
  getCategoryTotals as getFinalCategoryTotals,
  getFinalLedgerTransactions,
  getIncomeTotals as getFinalIncomeTotals,
  getFinalLedgerResult,
} from "./ledgerEngine";

function userTransactionsCol(userId: string) {
  return collection(db, "users", userId, "transactions");
}
function userBillsCol(userId: string) {
  return collection(db, "users", userId, "bills");
}
function userMonthsCol(userId: string) {
  return collection(db, "users", userId, "months");
}
function userRulesCol(userId: string) {
  return collection(db, "users", userId, "rules");
}

function tsToStr(ts: unknown): string {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === "string") return ts;
  return new Date().toISOString();
}

/** Derive ISO month-start and month-end for a "YYYY-MM" key. */
function isoRangeForMonth(month: string): { isoStart: string; isoEnd: string } {
  const [year, mon] = month.split("-");
  return { isoStart: `${year}-${mon}-01`, isoEnd: `${year}-${mon}-31` };
}

/** Merge two snapshot arrays into a single deduped list, latest write wins. */
function mergeTransactionSnaps(
  a: Transaction[],
  b: Transaction[],
): Transaction[] {
  const byId = new Map<string, Transaction>();
  a.forEach((t) => byId.set(t.id, t));
  b.forEach((t) => byId.set(t.id, t));
  return Array.from(byId.values()).sort((x, y) => x.date.localeCompare(y.date));
}

export async function getTransactions(userId: string, month?: string): Promise<Transaction[]> {
  const col = userTransactionsCol(userId);
  if (!month) {
    const snap = await getDocsFromServer(query(col));
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  // Union: rows whose stored `month` matches OR whose ISO `date` falls in range.
  // Catches rows imported with a wrong/missing month field.
  const { isoStart, isoEnd } = isoRangeForMonth(month);
  const [snap1, snap2] = await Promise.all([
    getDocsFromServer(query(col, where("month", "==", month))),
    getDocsFromServer(query(col, where("date", ">=", isoStart), where("date", "<=", isoEnd))),
  ]);
  const a = snap1.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }));
  const b = snap2.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }));
  return mergeTransactionSnaps(a, b);
}

// ─── Source-count diagnostics ─────────────────────────────────────────────────

export interface TransactionSourceCounts {
  byMonthField: number;
  byDateRange: number;
  combined: number;
  onlyInMonthField: number;
  onlyInDateRange: number;
  inBoth: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

/** One-shot async read that shows exactly how many April rows exist by each query path. */
export async function getTransactionSourceCounts(
  userId: string,
  month: string,
): Promise<TransactionSourceCounts> {
  const col = userTransactionsCol(userId);
  const { isoStart, isoEnd } = isoRangeForMonth(month);
  const [snap1, snap2] = await Promise.all([
    getDocsFromServer(query(col, where("month", "==", month))),
    getDocsFromServer(query(col, where("date", ">=", isoStart), where("date", "<=", isoEnd))),
  ]);
  const ids1 = new Set(snap1.docs.map((d) => d.id));
  const ids2 = new Set(snap2.docs.map((d) => d.id));
  const inBoth = [...ids1].filter((id) => ids2.has(id)).length;

  const allById = new Map<string, Transaction>();
  snap1.docs.forEach((d) => allById.set(d.id, { id: d.id, ...(d.data() as Omit<Transaction, "id">) }));
  snap2.docs.forEach((d) => allById.set(d.id, { id: d.id, ...(d.data() as Omit<Transaction, "id">) }));

  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const tx of allById.values()) {
    const s = tx.status || "undefined";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    const ty = tx.type || "expense";
    byType[ty] = (byType[ty] ?? 0) + 1;
  }
  return {
    byMonthField: ids1.size,
    byDateRange: ids2.size,
    combined: allById.size,
    onlyInMonthField: ids1.size - inBoth,
    onlyInDateRange: ids2.size - inBoth,
    inBoth,
    byStatus,
    byType,
  };
}

export async function addTransaction(userId: string, tx: Omit<Transaction, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const col = userTransactionsCol(userId);
  const ref = await addDoc(col, {
    ...tx,
    userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateTransaction(userId: string, txId: string, data: Partial<Transaction>): Promise<void> {
  const ref = doc(db, "users", userId, "transactions", txId);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

export async function deleteTransaction(userId: string, txId: string): Promise<void> {
  const ref = doc(db, "users", userId, "transactions", txId);
  await deleteDoc(ref);
}

export async function bulkAddTransactions(userId: string, txs: Omit<Transaction, "id" | "createdAt" | "updatedAt">[]): Promise<string[]> {
  const col = userTransactionsCol(userId);
  const ids: string[] = [];
  const BATCH_SIZE = 490;
  const now = serverTimestamp();

  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const chunk = txs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const chunkRefs: ReturnType<typeof doc>[] = [];
    for (const tx of chunk) {
      const ref = doc(col);
      chunkRefs.push(ref);
      batch.set(ref, { ...tx, userId, createdAt: now, updatedAt: now });
    }
    await batch.commit();
    chunkRefs.forEach((r) => ids.push(r.id));
  }
  return ids;
}

export async function getBills(userId: string, month?: string): Promise<Bill[]> {
  const col = userBillsCol(userId);
  const snap = await getDocsFromServer(col);
  const bills = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Bill, "id">) }));
  if (month) return bills.filter((b) => !b.month || b.month === month);
  return bills;
}

export async function addBill(userId: string, bill: Omit<Bill, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const col = userBillsCol(userId);
  const ref = await addDoc(col, {
    ...bill,
    userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateBill(userId: string, billId: string, data: Partial<Bill>): Promise<void> {
  const ref = doc(db, "users", userId, "bills", billId);
  // Convert undefined values to deleteField() — Firestore throws on raw undefined
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    clean[k] = v === undefined ? deleteField() : v;
  }
  await updateDoc(ref, { ...clean, updatedAt: serverTimestamp() });
}

export async function deleteBill(userId: string, billId: string): Promise<void> {
  const ref = doc(db, "users", userId, "bills", billId);
  await deleteDoc(ref);
}

export async function getMonths(userId: string): Promise<Month[]> {
  const col = userMonthsCol(userId);
  const snap = await getDocsFromServer(query(col, orderBy("month", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Month, "id">) }));
}

export async function upsertMonth(userId: string, monthKey: string, data: Partial<Month>): Promise<void> {
  const ref = doc(db, "users", userId, "months", monthKey);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, data);
  } else {
    await setDoc(ref, {
      month: monthKey,
      isClosed: false,
      totalSpending: 0,
      userId,
      createdAt: serverTimestamp(),
      ...data,
    });
  }
}

export async function getRules(userId: string): Promise<Rule[]> {
  const col = userRulesCol(userId);
  const snap = await getDocs(query(col, orderBy("priority", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Rule, "id">) }));
}

export async function addRule(userId: string, rule: Omit<Rule, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const col = userRulesCol(userId);
  const ref = await addDoc(col, {
    ...rule,
    userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateRule(userId: string, ruleId: string, data: Partial<Rule>): Promise<void> {
  const ref = doc(db, "users", userId, "rules", ruleId);
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

export async function deleteRule(userId: string, ruleId: string): Promise<void> {
  const ref = doc(db, "users", userId, "rules", ruleId);
  await deleteDoc(ref);
}

export async function recalculateMonthTotals(userId: string, month: string): Promise<void> {
  const transactions = await getTransactions(userId, month);
  const scoped = filterTransactionsToCalendarMonth(transactions, month);
  const { spending: totalSpending, income: totalIncome } = computeAuditedMonthTotals(scoped);
  await upsertMonth(userId, month, { totalSpending, totalIncome });
}

export interface RepairResult {
  scanned: number;
  repaired: number;
  monthFixed: number;
  typeFixed: number;
  categoryFixed: number;
  duplicateFlagCleared: number;
}

/** Fetches ALL transactions (bypassing month filter), finds any belonging to the target month
 *  by actual date, and corrects month, type, category, and isDuplicate fields in Firestore. */
export async function repairTransactionsForMonth(userId: string, targetMonth: string): Promise<RepairResult> {
  const col = userTransactionsCol(userId);
  const snap = await getDocsFromServer(query(col));
  const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }));

  const [year, mon] = targetMonth.split("-");

  function dateMatchesMonth(date: string): boolean {
    if (date.startsWith(targetMonth)) return true;
    const slash = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!slash) return false;
    const mm = slash[1].padStart(2, "0");
    const yy = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return yy === year && mm === mon;
  }

  function isoFromDate(date: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const slash = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!slash) return date;
    const [, mm, dd, yy] = slash;
    const fullYear = yy.length === 2 ? `20${yy}` : yy;
    return `${fullYear}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  function monthFromDate(date: string): string {
    const iso = isoFromDate(date);
    const parts = iso.split("-");
    if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
    return targetMonth;
  }

  function engineType(tx: Transaction): { type: "income" | "expense"; category: string } {
    const final = getFinalLedgerResult([tx]).finalRows;
    return final[0]
      ? { type: final[0].type as "income" | "expense", category: final[0].category as string }
      : { type: (tx.type as "income" | "expense") ?? "expense", category: tx.category as string };
  }

  const result: RepairResult = { scanned: 0, repaired: 0, monthFixed: 0, typeFixed: 0, categoryFixed: 0, duplicateFlagCleared: 0 };

  const BATCH_SIZE = 400;
  let batch = writeBatch(db);
  let batchCount = 0;

  async function flushBatch() {
    if (batchCount === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchCount = 0;
  }

  for (const tx of all) {
    if (!dateMatchesMonth(tx.date) && tx.month !== targetMonth) continue;
    result.scanned++;

    const correctMonth = monthFromDate(tx.date);
    const correctDate = isoFromDate(tx.date);
    const classified = engineType(tx);
    const correctType = classified.type as "income" | "expense";
    const correctCategory = correctType === "expense" ? classified.category : tx.category;

    const updates: Record<string, unknown> = {};

    if (tx.month !== correctMonth) { updates.month = correctMonth; result.monthFixed++; }
    if (correctDate !== tx.date) { updates.date = correctDate; }
    if (tx.type !== correctType) { updates.type = correctType; result.typeFixed++; }
    if (correctType === "expense" && tx.category !== correctCategory) { updates.category = correctCategory; result.categoryFixed++; }
    if (correctType === "income" && !tx.incomeCategory) {
      updates.incomeCategory = detectIncomeCategory(tx.name);
    }
    if (tx.isDuplicate) { updates.isDuplicate = false; result.duplicateFlagCleared++; }

    if (Object.keys(updates).length === 0) continue;

    result.repaired++;
    const ref = doc(db, "users", userId, "transactions", tx.id);
    batch.update(ref, { ...updates, updatedAt: serverTimestamp() });
    batchCount++;

    if (batchCount >= BATCH_SIZE) await flushBatch();
  }

  await flushBatch();
  return result;
}

export async function reapplyRulesToTransactions(
  userId: string,
  rules: Rule[],
  month?: string
): Promise<number> {
  const txs = await getTransactions(userId, month);
  let updated = 0;
  for (const tx of txs) {
    if (tx.type === "income") {
      const incomeCategory = tx.incomeCategory ?? detectIncomeCategory(tx.name);
      if (incomeCategory !== tx.incomeCategory) {
        await updateTransaction(userId, tx.id, { incomeCategory });
        updated++;
      }
      continue;
    }

    const { category, status } = getCategoryForTransaction({ name: tx.name, amount: Math.abs(tx.amount) }, rules);
    if (category !== tx.category || status !== tx.status || tx.isDuplicate) {
      await updateTransaction(userId, tx.id, { category, status, isDuplicate: false });
      updated++;
    }
  }
  return updated;
}

// ─── Bill Manager ledger log ────────────────────────────────────────────────
// Stored as users/{uid}/settings/billManagerLog: { [month]: { [billId]: txId } }
// Allows exact undo of ledger entries created by Mark All Paid / individual toggles.

export async function getBillManagerLog(userId: string, month: string): Promise<Record<string, string>> {
  const ref = doc(db, "users", userId, "settings", "billManagerLog");
  const snap = await getDoc(ref);
  const savedLog = snap.exists() ? ((snap.data()?.[month] as Record<string, string>) ?? {}) : {};

  const txSnap = await getDocsFromServer(
    query(
      userTransactionsCol(userId),
      where("month", "==", month),
      where("note", "==", "Added from Bill Manager"),
    ),
  );
  const liveLog: Record<string, string> = {};
  txSnap.docs.forEach((txDoc) => {
    const tx = txDoc.data() as Transaction;
    if (tx.billId) liveLog[tx.billId] = txDoc.id;
  });

  return { ...savedLog, ...liveLog };
}

export async function saveBillManagerEntry(userId: string, month: string, billId: string, txId: string): Promise<void> {
  const ref = doc(db, "users", userId, "settings", "billManagerLog");
  await setDoc(ref, { [month]: { [billId]: txId } }, { merge: true });
}

export async function clearBillManagerMonth(userId: string, month: string): Promise<void> {
  const ref = doc(db, "users", userId, "settings", "billManagerLog");
  await setDoc(ref, { [month]: {} }, { merge: true });
}

export async function removeBillManagerEntry(userId: string, month: string, billId: string): Promise<void> {
  const ref = doc(db, "users", userId, "settings", "billManagerLog");
  await updateDoc(ref, { [`${month}.${billId}`]: deleteField() });
}

// Bill IDs touched by "Mark All Paid" for a month (cumulative until Undo All clears it).
// Undo All only reverts paid state for these bills — not bills that were already paid before Mark All.
// Document: users/{uid}/settings/billManagerMarkAllSnapshot → { [month]: string[] }

export async function saveMarkAllPaidAffectedBillIds(
  userId: string,
  month: string,
  billIds: string[]
): Promise<void> {
  const ref = doc(db, "users", userId, "settings", "billManagerMarkAllSnapshot");
  await setDoc(ref, { [month]: billIds }, { merge: true });
}

/** Returns undefined if no snapshot exists for this month (use legacy undo heuristic). */
export async function getMarkAllPaidAffectedBillIds(
  userId: string,
  month: string
): Promise<string[] | undefined> {
  const ref = doc(db, "users", userId, "settings", "billManagerMarkAllSnapshot");
  const snap = await getDoc(ref);
  if (!snap.exists()) return undefined;
  const ids = snap.data()?.[month] as unknown;
  if (!Array.isArray(ids)) return undefined;
  return ids.filter((id): id is string => typeof id === "string");
}

export async function clearMarkAllPaidSnapshot(userId: string, month: string): Promise<void> {
  const ref = doc(db, "users", userId, "settings", "billManagerMarkAllSnapshot");
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await updateDoc(ref, { [month]: deleteField() });
}

export async function getCustomCategories(userId: string): Promise<string[]> {
  const ref = doc(db, "users", userId, "settings", "categories");
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  return (snap.data()?.custom as string[]) || [];
}

export async function saveCustomCategories(userId: string, categories: string[]): Promise<void> {
  const ref = doc(db, "users", userId, "settings", "categories");
  await setDoc(ref, { custom: categories }, { merge: true });
}

export function computeCategoryTotals(transactions: Transaction[]): Record<string, number> {
  const totals: Record<string, number> = {
    Bills: 0, Fuel: 0, Necessary: 0, Medical: 0, Shopping: 0,
    Transfers: 0, Personal: 0, Waste: 0, Work: 0, Uncategorized: 0,
  };
  return { ...totals, ...getFinalCategoryTotals(getFinalLedgerTransactions(transactions)) };
}

// Real-time listener: fires whenever bills change in Firestore.
// Returns an unsubscribe function — call it on component unmount.
export function subscribeBills(userId: string, callback: (bills: Bill[]) => void): () => void {
  const col = userBillsCol(userId);
  return onSnapshot(
    col,
    (snap) => {
      const bills = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Bill, "id">) }));
      callback(bills);
    },
    (err) => {
      console.error("[subscribeBills]", err);
      callback([]);
    },
  );
}

// Real-time listener: fires whenever transactions change in Firestore.
// Optionally filtered to a specific month.
export function subscribeTransactions(
  userId: string,
  month: string | undefined,
  callback: (txs: Transaction[]) => void
): () => void {
  const col = userTransactionsCol(userId);
  // `undefined` = all months (e.g. duplicate scan). `""` = month not ready yet — do not query entire collection.
  if (month === "") {
    queueMicrotask(() => callback([]));
    return () => {};
  }
  if (month === undefined) {
    return onSnapshot(
      query(col),
      (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }))),
      (err) => { console.error("[subscribeTransactions]", err); callback([]); },
    );
  }

  // Dual-query union: rows by stored month field + rows by ISO date string.
  // This catches rows with a corrupted/missing month field so they still appear
  // when the user views the correct month.
  const { isoStart, isoEnd } = isoRangeForMonth(month);
  const q1 = query(col, where("month", "==", month));
  const q2 = query(col, where("date", ">=", isoStart), where("date", "<=", isoEnd));

  let data1: Transaction[] = [];
  let data2: Transaction[] = [];

  function emit() {
    callback(mergeTransactionSnaps(data1, data2));
  }

  const unsub1 = onSnapshot(
    q1,
    (snap) => {
      data1 = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }));
      emit();
    },
    (err) => { console.error("[subscribeTransactions q1]", err); },
  );

  const unsub2 = onSnapshot(
    q2,
    (snap) => {
      data2 = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }));
      emit();
    },
    (err) => { console.error("[subscribeTransactions q2]", err); },
  );

  return () => { unsub1(); unsub2(); };
}

export function computeIncomeTotals(transactions: Transaction[]): Record<string, number> {
  const totals: Record<string, number> = {
    Payroll: 0,
    "Gig Work": 0,
    "Cash Transfer": 0,
    "Side Business": 0,
    "Other Income": 0,
  };
  return { ...totals, ...getFinalIncomeTotals(getFinalLedgerTransactions(transactions)) };
}
