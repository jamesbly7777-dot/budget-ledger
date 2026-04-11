import type { ImportPreviewItem, IncomeCategory, Rule, Transaction, TransactionCategory, TransactionStatus, TransactionType } from "./types";

const BUILT_IN_RULES_PRIORITY = 100;

interface RawTransaction {
  date: string;
  name: string;
  amount: number;
  rawCategory?: string;
  txType?: TransactionType;
  incomeCategory?: IncomeCategory;
}

function applyFuelRule(name: string, amount: number): TransactionCategory | null {
  const isGas = /gas|gasoline|shell|chevron|exxon|mobil|bp|sunoco|speedway|quiktrip|qt |kwik|circle k|fuel|petro/i.test(name);
  if (isGas) {
    return amount >= 15 ? "Fuel" : "Waste";
  }
  return null;
}

function applySkipRule(name: string): boolean {
  const skipPatterns = [/irs/i, /verizon/i];
  return skipPatterns.some((p) => p.test(name));
}

function detectIncomeCategory(name: string): IncomeCategory {
  if (/direct deposit|payroll|salary|ddp|adp|gusto|paychex|paylocity|ach credit|oasdi|employer/i.test(name)) return "Payroll";
  if (/zelle|venmo|paypal|cashapp|cash app|square cash/i.test(name)) return "Cash Transfer";
  if (/1099|freelance|invoice|upwork|fiverr|etsy|stripe payout/i.test(name)) return "Gig Work";
  if (/llc|inc|business|consulting/i.test(name)) return "Side Business";
  return "Other Income";
}

function applyTransferRule(name: string): boolean {
  // Note: "deposit" intentionally removed — positive deposits are handled as income upstream
  return /transfer|zelle|venmo|paypal|cashapp|savings/i.test(name);
}

function applyWasteRule(name: string): boolean {
  return /mcdonald|burger king|wendy|taco bell|pizza|subway|chick-fil|starbucks|dunkin|donut|vending|snack|fast food|dollar tree|dollar general/i.test(name);
}

function applyNecessaryRule(name: string): boolean {
  return /walmart|kroger|aldi|costco|sam's|grocery|market|pharmacy|walgreens|cvs|rite aid|household|utility|electric|gas company|water bill/i.test(name);
}

function applyMedicalRule(name: string): boolean {
  return /hospital|clinic|doctor|dentist|pharmacy|health|medical|ortho|therapy|urgent care|vision|eye care|lab|radiology|er |emergency room/i.test(name);
}

function applyBillsRule(name: string): boolean {
  return /rent|loan|mortgage|credit|affirm|insurance|subscription|netflix|spotify|apple|google one|amazon prime|hulu|cable|internet|cox|at&t|t-mobile|xfinity|comcast|planet fitness|gym|coursera|codecademy|chatgpt|prime video|freetaxusa|pikepass|integris|southwest ortho|carecredit/i.test(name);
}

function categorizeByRules(
  raw: RawTransaction,
  userRules: Rule[]
): { category: TransactionCategory; status: TransactionStatus; skip: boolean; ruleApplied?: string } {
  const { name, amount } = raw;

  const sortedUserRules = [...userRules].sort((a, b) => a.priority - b.priority);
  for (const rule of sortedUserRules) {
    if (!rule.isActive) continue;
    const { condition, action } = rule;

    let matches = false;
    const fieldValue = condition.field === "amount" ? amount : name;
    const compareValue = condition.value;

    if (condition.field === "name" && typeof fieldValue === "string" && typeof compareValue === "string") {
      const a = condition.caseSensitive ? fieldValue : fieldValue.toLowerCase();
      const b = condition.caseSensitive ? compareValue : compareValue.toLowerCase();
      if (condition.operator === "contains") matches = a.includes(b);
      else if (condition.operator === "equals") matches = a === b;
      else if (condition.operator === "not_contains") matches = !a.includes(b);
    } else if (condition.field === "amount" && typeof fieldValue === "number" && typeof compareValue === "number") {
      if (condition.operator === "gt") matches = fieldValue > compareValue;
      else if (condition.operator === "lt") matches = fieldValue < compareValue;
      else if (condition.operator === "gte") matches = fieldValue >= compareValue;
      else if (condition.operator === "lte") matches = fieldValue <= compareValue;
      else if (condition.operator === "equals") matches = fieldValue === compareValue;
    }

    if (matches) {
      if (action.type === "skip") return { category: "Uncategorized", status: "cleared", skip: true, ruleApplied: rule.name };
      if (action.type === "set_category" && action.category) {
        return { category: action.category, status: "cleared", skip: false, ruleApplied: rule.name };
      }
      if (action.type === "flag_review") {
        return { category: "Uncategorized", status: "review", skip: false, ruleApplied: rule.name };
      }
      if (action.type === "set_status" && action.status) {
        return { category: "Uncategorized", status: action.status, skip: false, ruleApplied: rule.name };
      }
    }
  }

  if (applySkipRule(name)) {
    return { category: "Uncategorized", status: "cleared", skip: true, ruleApplied: "Built-in: Skip IRS/Verizon" };
  }

  const fuelCategory = applyFuelRule(name, amount);
  if (fuelCategory) {
    return { category: fuelCategory, status: "cleared", skip: false, ruleApplied: `Built-in: Fuel Rule (${fuelCategory})` };
  }

  if (applyTransferRule(name)) {
    return { category: "Transfers", status: "cleared", skip: false, ruleApplied: "Built-in: Transfer Rule" };
  }

  if (applyMedicalRule(name)) {
    return { category: "Medical", status: "cleared", skip: false, ruleApplied: "Built-in: Medical Rule" };
  }

  if (applyBillsRule(name)) {
    return { category: "Bills", status: "cleared", skip: false, ruleApplied: "Built-in: Bills Rule" };
  }

  if (applyNecessaryRule(name)) {
    return { category: "Necessary", status: "cleared", skip: false, ruleApplied: "Built-in: Necessary Rule" };
  }

  if (applyWasteRule(name)) {
    return { category: "Waste", status: "cleared", skip: false, ruleApplied: "Built-in: Waste Rule" };
  }

  return { category: "Uncategorized", status: "review", skip: false, ruleApplied: undefined };
}

function isDuplicate(item: RawTransaction, existing: Transaction[]): { isDuplicate: boolean; duplicateOf?: string } {
  const match = existing.find((t) => {
    const sameDate = t.date === item.date;
    const sameName = t.name.toLowerCase().trim() === item.name.toLowerCase().trim();
    const sameAmount = Math.abs(t.amount - item.amount) < 0.01;
    return sameDate && sameName && sameAmount;
  });
  return { isDuplicate: !!match, duplicateOf: match?.id };
}

export function runRulesEngine(
  rawItems: RawTransaction[],
  userRules: Rule[],
  existingTransactions: Transaction[]
): ImportPreviewItem[] {
  const results: ImportPreviewItem[] = [];
  const seenInBatch = new Map<string, string>();

  for (const item of rawItems) {
    const txType = item.txType ?? "expense";

    const batchKey = `${item.date}|${item.name.toLowerCase().trim()}|${item.amount}|${txType}`;
    const existingDup = isDuplicate(item, existingTransactions);

    let batchDupOf: string | undefined;
    if (seenInBatch.has(batchKey)) {
      batchDupOf = seenInBatch.get(batchKey);
    } else {
      seenInBatch.set(batchKey, item.date + "_" + item.name);
    }

    const duplicate = existingDup.isDuplicate || !!batchDupOf;

    if (txType === "income") {
      const previewItem: ImportPreviewItem = {
        id: crypto.randomUUID(),
        date: item.date,
        name: item.name,
        amount: item.amount,
        rawCategory: item.rawCategory,
        resolvedCategory: "Uncategorized",
        status: duplicate ? "review" : "cleared",
        txType: "income",
        incomeCategory: item.incomeCategory ?? detectIncomeCategory(item.name),
        isDuplicate: duplicate,
        duplicateOf: existingDup.duplicateOf || batchDupOf,
        ruleApplied: undefined,
        action: duplicate ? "review" : "save",
      };
      results.push(previewItem);
      continue;
    }

    const { category, status, skip, ruleApplied } = categorizeByRules(item, userRules);
    if (skip) continue;

    const previewItem: ImportPreviewItem = {
      id: crypto.randomUUID(),
      date: item.date,
      name: item.name,
      amount: item.amount,
      rawCategory: item.rawCategory,
      resolvedCategory: category,
      status: duplicate ? "review" : status,
      txType: "expense",
      isDuplicate: duplicate,
      duplicateOf: existingDup.duplicateOf || batchDupOf,
      ruleApplied,
      action: duplicate ? "review" : "save",
    };
    results.push(previewItem);
  }

  return results;
}

export function getCategoryForTransaction(
  tx: { name: string; amount: number },
  userRules: Rule[]
): { category: TransactionCategory; status: TransactionStatus } {
  const { category, status } = categorizeByRules(
    { date: "", name: tx.name, amount: tx.amount },
    userRules
  );
  return { category, status };
}

export function getMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}
