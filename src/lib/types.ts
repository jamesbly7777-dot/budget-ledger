export type TransactionCategory =
  | "Bills"
  | "Fuel"
  | "Necessary"
  | "Medical"
  | "Shopping"
  | "Transfers"
  | "Personal"
  | "Waste"
  | "Uncategorized";

export const DEFAULT_EXPENSE_CATEGORIES: string[] = [
  "Bills", "Fuel", "Necessary", "Medical", "Shopping",
  "Transfers", "Personal", "Waste", "Uncategorized",
];

export type IncomeCategory =
  | "Payroll"
  | "Gig Work"
  | "Cash Transfer"
  | "Side Business"
  | "Other Income";

export const INCOME_CATEGORIES: IncomeCategory[] = [
  "Payroll",
  "Gig Work",
  "Cash Transfer",
  "Side Business",
  "Other Income",
];

export type TransactionType = "expense" | "income";

export type TransactionStatus = "cleared" | "pending" | "review";

export interface Transaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  status: TransactionStatus;
  type?: TransactionType;
  incomeCategory?: IncomeCategory;
  note?: string;
  month: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  importedAt?: string;
  sourceFile?: string;
  isDuplicate?: boolean;
  splitFrom?: string;
  billId?: string;
}

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  category: string;
  isRecurring: boolean;
  month?: string;
  isPaid: boolean;
  paidMonths?: string[];
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Month {
  id: string;
  month: string;
  year: number;
  label: string;
  totalIncome?: number;
  totalSpending: number;
  isClosed: boolean;
  userId: string;
  createdAt: string;
}

export interface Rule {
  id: string;
  name: string;
  condition: RuleCondition;
  action: RuleAction;
  isActive: boolean;
  priority: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuleCondition {
  field: "name" | "amount" | "category";
  operator: "contains" | "equals" | "gt" | "lt" | "gte" | "lte" | "not_contains";
  value: string | number;
  caseSensitive?: boolean;
}

export interface RuleAction {
  type: "set_category" | "skip" | "flag_review" | "set_status";
  category?: TransactionCategory;
  status?: TransactionStatus;
  note?: string;
}

export interface ImportPreviewItem {
  id: string;
  date: string;
  name: string;
  amount: number;
  rawCategory?: string;
  resolvedCategory: TransactionCategory;
  status: TransactionStatus;
  txType: TransactionType;
  incomeCategory?: IncomeCategory;
  isDuplicate: boolean;
  duplicateOf?: string;
  ruleApplied?: string;
  action: "save" | "skip" | "review";
  recurringBill?: boolean;
}

export interface MonthSummary {
  month: string;
  label: string;
  totalSpending: number;
  totalIncome: number;
  byCategory: Record<TransactionCategory, number>;
  byIncomeCategory: Record<IncomeCategory, number>;
  billsTotal: number;
  wasteTotal: number;
  medicalTotal: number;
  fuelTotal: number;
  transactionCount: number;
  incomeCount: number;
}
