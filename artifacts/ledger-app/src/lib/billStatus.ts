import type { Bill, Transaction } from "./types";

export function isPaidInMonth(bill: Bill, month: string): boolean {
  if (bill.paidMonths) return bill.paidMonths.includes(month);
  return bill.isPaid;
}

export function findLinkedTransaction(bill: Bill, transactions: Transaction[]): Transaction | undefined {
  const byId = transactions.find((tx) => tx.billId === bill.id);
  if (byId) return byId;
  const billWords = bill.name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length >= 4);
  if (billWords.length === 0) return undefined;
  return transactions.find((tx) => {
    if (tx.type === "income") return false;
    if (tx.note === "Added from Bill Manager") return false;
    if (tx.billId) return false;
    const txName = tx.name.toLowerCase();
    return billWords.some((word) => txName.includes(word));
  });
}

export function isEffectivelyPaidInMonth(bill: Bill, month: string, transactions: Transaction[]): boolean {
  return isPaidInMonth(bill, month) || !!findLinkedTransaction(bill, transactions);
}

export function billsForBillManagerMonth(bills: Bill[]): Bill[] {
  return bills.filter((b) => b.isActive !== false);
}
