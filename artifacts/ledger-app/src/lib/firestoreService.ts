import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Bill, Month, Rule, Transaction, TransactionCategory } from "./types";
import { getCategoryForTransaction } from "./rulesEngine";

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

export async function getTransactions(userId: string, month?: string): Promise<Transaction[]> {
  const col = userTransactionsCol(userId);
  const q = month
    ? query(col, where("month", "==", month), orderBy("date", "asc"))
    : query(col, orderBy("date", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, "id">) }));
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
  const ids: string[] = [];
  for (const tx of txs) {
    const id = await addTransaction(userId, tx);
    ids.push(id);
  }
  return ids;
}

export async function getBills(userId: string, month?: string): Promise<Bill[]> {
  const col = userBillsCol(userId);
  const snap = await getDocs(col);
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
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() });
}

export async function deleteBill(userId: string, billId: string): Promise<void> {
  const ref = doc(db, "users", userId, "bills", billId);
  await deleteDoc(ref);
}

export async function getMonths(userId: string): Promise<Month[]> {
  const col = userMonthsCol(userId);
  const snap = await getDocs(query(col, orderBy("month", "desc")));
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
  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  await upsertMonth(userId, month, { totalSpending: total });
}

export async function reapplyRulesToTransactions(
  userId: string,
  rules: Rule[],
  month?: string
): Promise<number> {
  const txs = await getTransactions(userId, month);
  let updated = 0;
  for (const tx of txs) {
    const { category, status } = getCategoryForTransaction({ name: tx.name, amount: tx.amount }, rules);
    if (category !== tx.category || status !== tx.status) {
      await updateTransaction(userId, tx.id, { category, status });
      updated++;
    }
  }
  return updated;
}

export function computeCategoryTotals(transactions: Transaction[]): Record<TransactionCategory, number> {
  const totals: Record<TransactionCategory, number> = {
    Bills: 0,
    Fuel: 0,
    Necessary: 0,
    Medical: 0,
    Shopping: 0,
    Transfers: 0,
    Personal: 0,
    Waste: 0,
    Uncategorized: 0,
  };
  for (const t of transactions) {
    if (t.category in totals) {
      totals[t.category] += t.amount;
    }
  }
  return totals;
}
