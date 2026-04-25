import type { ImportPreviewItem, IncomeCategory, Rule, Transaction, TransactionCategory, TransactionStatus, TransactionType } from "./types";

const BUILT_IN_RULES_PRIORITY = 100;
const MERCHANT_OVERRIDE_STORAGE_KEY = "ledgerMerchantCategoryOverrides";

export type MerchantCategoryOverride = { match: string; category: TransactionCategory };

export function loadMerchantCategoryOverrides(): MerchantCategoryOverride[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MERCHANT_OVERRIDE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is MerchantCategoryOverride =>
        !!x && typeof (x as MerchantCategoryOverride).match === "string" && typeof (x as MerchantCategoryOverride).category === "string",
    );
  } catch {
    return [];
  }
}

export function saveMerchantCategoryOverrides(overrides: MerchantCategoryOverride[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MERCHANT_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
}

function categoryFromStoredMerchantOverride(name: string): TransactionCategory | null {
  const n = name.toLowerCase();
  for (const o of loadMerchantCategoryOverrides()) {
    if (!o.match) continue;
    if (n.includes(o.match.toLowerCase())) return o.category;
  }
  return null;
}

interface RawTransaction {
  date: string;
  name: string;
  amount: number;
  rawCategory?: string;
  txType?: TransactionType;
  incomeCategory?: IncomeCategory;
}

function applyFuelRule(name: string, amount: number): TransactionCategory | null {
  const isGas =
    /gas|gasoline|shell|chevron|exxon|exxon\s*mobil|exxonmobil|bp|sunoco|speedway|quiktrip|\bqt\b|kwik|circle k|fuel|petro|oncue|7-?eleven.*fuel|casey'?s|caseys|papa'?s|outside.*fuel|fuel.*outside/i.test(
      name,
    );
  if (isGas) {
    if (amount >= 15) return "Fuel";
    if (/\binside\b|in-store|snack|vend|convenience|market(?!ing)/i.test(name) || /oncue|casey'?s|caseys|papa'?s|\bqt\b|quiktrip/i.test(name)) return "Waste";
    return amount >= 15 ? "Fuel" : "Waste";
  }
  return null;
}

function applySkipRule(name: string): boolean {
  const skipPatterns: RegExp[] = [];
  return skipPatterns.some((p) => p.test(name));
}

export function detectIncomeCategory(name: string): IncomeCategory {
  if (/direct deposit|payroll|salary|ddp|adp|gusto|paychex|paylocity|ach credit|oasdi|employer/i.test(name)) return "Payroll";
  if (/zelle|venmo|paypal|cashapp|cash app|square cash/i.test(name)) return "Cash Transfer";
  if (/1099|freelance|invoice|upwork|fiverr|etsy|stripe payout|gd-amazon|amzn|amazon flex|flex pay|amazon transfer|shipt pay|shipt/i.test(name)) return "Gig Work";
  if (/llc|inc|business|consulting/i.test(name)) return "Side Business";
  return "Other Income";
}

function applyTransferRule(name: string): boolean {
  // Note: "deposit" intentionally removed — positive deposits are handled as income upstream
  return /transfer|zelle|venmo|paypal|cashapp|savings|save as you go|sayg/i.test(name);
}

function applyWasteRule(name: string): boolean {
  return /mcdonald|burger king|wendy|taco bell|pizza|subway|chick-fil|freddy|whataburger|cold\s*stone|coldstone|starbucks|dunkin|donut|vending|snack|fast food|dollar tree|hobby lobby.*vend|ongo express|store oklahoma city|oklahoma city store/i.test(
    name,
  );
}

function applyNecessaryRule(name: string): boolean {
  return /walmart|kroger|aldi|costco|sam's|grocery|market|pharmacy|household|utility|electric|gas company|water bill|club car wash|car wash|cash app.*car|amazon grocery|dollar general/i.test(
    name,
  );
}

function applyMedicalRule(name: string): boolean {
  return /hospital|clinic|doctor|dentist|health|medical|ortho|therapy|urgent care|vision|eye care|lab|radiology|er |emergency room|village lane|village ln|low t\b|integris|southwest ortho|pain center|emergency service|medical pain|\bwalgreens\b|\bcvs\b|\brite aid\b/i.test(
    name,
  );
}

function applyBillsRule(name: string): boolean {
  return /rent|loan|mortgage|credit|affirm|insurance|netflix|amazon prime|cable|internet|cox|at&t|t-mobile|xfinity|comcast|planet fitness|coursera|codecademy|freetaxusa|pikepass|carecredit|dave inc|dave fee|pyrvia|oge|og&e|lemonade|us dept of education|student loan|walmart\+|wf loan|wells fargo.*payment|synchrony payment|flexible finance|flex finance|oklahoma motor/i.test(
    name,
  );
}

function applyHardCategoryRules(name: string, amount: number): { category: TransactionCategory; ruleApplied: string } | null {
  if (applyWasteRule(name)) return { category: "Waste", ruleApplied: "Hard rule: Waste merchant" };

  const fuelCategory = applyFuelRule(name, amount);
  if (fuelCategory) return { category: fuelCategory, ruleApplied: `Hard rule: Fuel station (${fuelCategory})` };

  if (/save as you go|sayg/i.test(name)) return { category: "Transfers", ruleApplied: "Hard rule: Save As You Go" };

  if (/medical|integris|pain|hospital|clinic|doctor|dentist|urgent care|emergency service|walgreens|cvs|rite aid/i.test(name)) {
    return { category: "Medical", ruleApplied: "Hard rule: Medical" };
  }

  if (/replit|openai|chatgpt|cursor|google one|saner\s*ai|lemsqzy|lem\s*sqzy/i.test(name)) {
    return { category: "Work", ruleApplied: "Hard rule: Work / AI tools" };
  }

  if (/amazon marketplace/i.test(name)) return { category: "Shopping", ruleApplied: "Hard rule: Amazon Marketplace" };
  if (/walmart\+/i.test(name)) return { category: "Bills", ruleApplied: "Hard rule: Walmart+ subscription" };
  if (/walmart|amazon grocery|amazon household|dollar general|club car wash|cash app.*car/i.test(name)) {
    return { category: "Necessary", ruleApplied: "Hard rule: Necessary Living" };
  }
  if (/amazon/i.test(name) && !/amazon prime|prime video|audible|\baws\b|flex finance|flexible finance|amazon flex|amazon transfer|gig work/i.test(name)) {
    return Math.abs(amount) >= 40
      ? { category: "Necessary", ruleApplied: "Hard rule: Amazon household ($40+)" }
      : { category: "Shopping", ruleApplied: "Hard rule: Amazon retail" };
  }

  if (applyBillsRule(name)) return { category: "Bills", ruleApplied: "Hard rule: Bills / Debt" };
  if (applyNecessaryRule(name)) return { category: "Necessary", ruleApplied: "Hard rule: Necessary Living" };

  return null;
}

export function isKnownExpenseMerchant(name: string, amount = 0): boolean {
  if (/transfer|payroll|salary|refund|return|reversal|cash transfer|shipt pay|gd-amazon|amazon flex|flex pay|gig work/i.test(name)) return false;
  if (/hobby lobby/i.test(name) && Math.abs(amount) < 15) return true;
  const hardRule = applyHardCategoryRules(name, Math.abs(amount));
  if (hardRule) return true;
  return /freddy|flex finance|medical pain|club car wash|cash app.*car|shell|oklahoma motor|dave inc|hobby lobby.*vend|emergency service|coldstone|og&e|wells fargo.*payment|affirm|synchrony|pyrvia|t-mobile|wf loan|dollar general|us dept of education|planet fitness|netflix|papa'?s|coursera|chick-fil/i.test(
    name,
  );
}

function categorizeByRules(
  raw: RawTransaction,
  userRules: Rule[]
): { category: TransactionCategory; status: TransactionStatus; skip: boolean; ruleApplied?: string } {
  const { name, amount } = raw;

  const hardRule = applyHardCategoryRules(name, amount);
  if (hardRule) {
    return { category: hardRule.category, status: "cleared", skip: false, ruleApplied: hardRule.ruleApplied };
  }

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
        return { category: action.category, status: "cleared", skip: false, ruleApplied: `category_override:${rule.name}` };
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

  const storedOverride = categoryFromStoredMerchantOverride(name);
  if (storedOverride) {
    return { category: storedOverride, status: "cleared", skip: false, ruleApplied: "category_override:merchant_memory" };
  }

  if (/saner\s*ai|^saner\b|lemsqzy|lem\s*sqzy|openai|chatgpt|anthropic|claude\.|cursor|replit|midjourney|replicate|gridwise|google one/i.test(name)) {
    return { category: "Work", status: "cleared", skip: false, ruleApplied: "Built-in: AI / research tools" };
  }
  if (/prime\s*video|primevideo/i.test(name)) {
    return { category: "Waste", status: "cleared", skip: false, ruleApplied: "Built-in: Prime Video (entertainment)" };
  }
  if (/papa|trading\s*co/i.test(name)) {
    if (amount < 15) {
      return { category: "Waste", status: "cleared", skip: false, ruleApplied: "Built-in: Papa’s small purchase" };
    }
    return { category: "Fuel", status: "cleared", skip: false, ruleApplied: "Built-in: Papa’s fuel" };
  }
  if (/oncue/i.test(name)) {
    if (/inside|snack|vend|convenience|cpg|market/i.test(name) || amount < 15) {
      return { category: "Waste", status: "cleared", skip: false, ruleApplied: "Built-in: OnCue non-fuel / inside" };
    }
    return { category: "Fuel", status: "cleared", skip: false, ruleApplied: "Built-in: OnCue fuel ($15+)" };
  }
  if (/\bqt\b|quiktrip/i.test(name) && /\binside\b|in-store|snack|vend|convenience/i.test(name)) {
    return { category: "Waste", status: "cleared", skip: false, ruleApplied: "Built-in: QT inside / snacks" };
  }
  if (/\bqt\b|quiktrip/i.test(name) && /\boutside\b|fuel|gas/i.test(name) && amount >= 15) {
    return { category: "Fuel", status: "cleared", skip: false, ruleApplied: "Built-in: QT outside fuel" };
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

  if (/amazon marketplace|fresh clips/i.test(name)) {
    return { category: "Shopping", status: "cleared", skip: false, ruleApplied: "Built-in: Shopping merchants" };
  }
  if (/amazon/i.test(name) && !/amazon prime|amazon grocery|whole foods|prime video|audible|\baws\b|flex finance|flexible finance|marketplace|amazon flex|amazon transfer|gig work/i.test(name)) {
    const a = Math.abs(amount);
    if (a >= 40) {
      return { category: "Necessary", status: "cleared", skip: false, ruleApplied: "Built-in: Amazon household ($40+)" };
    }
    return { category: "Shopping", status: "cleared", skip: false, ruleApplied: "Built-in: Amazon retail (<$40)" };
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

// ---------------------------------------------------------------------------
// Deduplication helpers — kept local to avoid circular import with ledgerEngine
// ---------------------------------------------------------------------------

import type { DuplicateReason } from "./types";

/** Strip punctuation, collapse whitespace, lowercase. Used for dedup key comparison. */
function normalizeMerchantForDedup(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract the first significant word (≥4 chars) from a normalised merchant name. */
function firstSignificantWord(norm: string): string {
  return norm.split(" ").find((w) => w.length >= 4) ?? norm.split(" ")[0] ?? norm;
}

/** Parse any ISO or MM/DD/YYYY date string to a UTC midnight Date. */
function parseDateForDedup(date: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(date + "T00:00:00Z");
  const slash = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const [, mm, dd, yy] = slash;
    const year = yy.length === 2 ? `20${yy}` : yy;
    return new Date(`${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T00:00:00Z`);
  }
  return null;
}

interface DuplicateResult {
  isDuplicate: boolean;
  duplicateOf?: string;
  reason?: DuplicateReason;
  /** exact = confirmed; fuzzy = suspected, requires user confirmation */
  confidence?: "exact" | "fuzzy";
}

/**
 * Two-pass expense duplicate detection:
 *
 * Pass 1 — Exact duplicate:
 *   Same normalised date + same normalised merchant name (full) + same amount.
 *   Safe to flag as `exact_duplicate`.
 *
 * Pass 2 — Posting-date offset (suspected only):
 *   Amount matches within $0.01, dates are 1–2 calendar days apart, AND
 *   the first significant word of both merchant names matches (≥4 chars).
 *   Flagged as `posting_date_match` with confidence="fuzzy".
 *   Fuzzy matches are shown to the user as suspected duplicates (action="review")
 *   but are NEVER automatically skipped — the user confirms.
 *
 * Safety guarantees:
 *   - Multiple legitimate payments (same merchant, same amount, same date) are
 *     only removed if they are truly identical (Pass 1).
 *   - Repeated payments on separate days that fall within the 2-day window are
 *     only flagged as suspected, never auto-removed.
 *   - "review"-status existing rows are still matched — the caller decides whether
 *     to import or skip; the existing row is never deleted.
 */
function isDuplicateExpense(item: RawTransaction, existing: Transaction[]): DuplicateResult {
  const itemNorm = normalizeMerchantForDedup(item.name);
  const itemDate = parseDateForDedup(item.date);
  const itemIso = itemDate
    ? `${itemDate.getUTCFullYear()}-${String(itemDate.getUTCMonth() + 1).padStart(2, "0")}-${String(itemDate.getUTCDate()).padStart(2, "0")}`
    : item.date;

  // Pass 1: exact match
  const exactMatch = existing.find((t) => {
    const tDate = parseDateForDedup(t.date);
    const tIso = tDate
      ? `${tDate.getUTCFullYear()}-${String(tDate.getUTCMonth() + 1).padStart(2, "0")}-${String(tDate.getUTCDate()).padStart(2, "0")}`
      : t.date;
    return tIso === itemIso && normalizeMerchantForDedup(t.name) === itemNorm && Math.abs(t.amount - item.amount) < 0.01;
  });
  if (exactMatch) {
    return { isDuplicate: true, duplicateOf: exactMatch.id, reason: "exact_duplicate", confidence: "exact" };
  }

  // Pass 2: posting-date offset (fuzzy, suspected only)
  if (itemDate) {
    const fuzzyMatch = existing.find((t) => {
      if (Math.abs(t.amount - item.amount) >= 0.01) return false;
      const tDate = parseDateForDedup(t.date);
      if (!tDate) return false;
      const daysDiff = Math.abs(itemDate.getTime() - tDate.getTime()) / 86_400_000;
      if (daysDiff < 1 || daysDiff > 2) return false; // daysDiff=0 → handled by Pass 1
      const tNorm = normalizeMerchantForDedup(t.name);
      // Strong name signal: first significant word (≥4 chars) must match exactly
      return firstSignificantWord(itemNorm) === firstSignificantWord(tNorm);
    });
    if (fuzzyMatch) {
      return { isDuplicate: true, duplicateOf: fuzzyMatch.id, reason: "posting_date_match", confidence: "fuzzy" };
    }
  }

  return { isDuplicate: false };
}

/**
 * Income-specific duplicate check — exact match ONLY.
 *
 * Rationale: Multiple legitimate Amazon Flex / "Save As You Go" transfers can
 * share the same merchant name and even the same amount on adjacent days.
 * A ±N-day fuzzy window would merge those legitimate repeated deposits.
 * Therefore income dedup uses exact date + exact name + exact amount only.
 *
 * For posting-date offsets on income rows the user will see the row in the
 * import preview as a new (non-duplicate) item and can manually skip it.
 */
function isDuplicateIncome(item: RawTransaction, existing: Transaction[]): DuplicateResult {
  const itemNorm = normalizeMerchantForDedup(item.name);
  const itemDate = parseDateForDedup(item.date);
  const itemIso = itemDate
    ? `${itemDate.getUTCFullYear()}-${String(itemDate.getUTCMonth() + 1).padStart(2, "0")}-${String(itemDate.getUTCDate()).padStart(2, "0")}`
    : item.date;

  const match = existing.find((t) => {
    if (t.type !== "income") return false;
    const tDate = parseDateForDedup(t.date);
    const tIso = tDate
      ? `${tDate.getUTCFullYear()}-${String(tDate.getUTCMonth() + 1).padStart(2, "0")}-${String(tDate.getUTCDate()).padStart(2, "0")}`
      : t.date;
    return tIso === itemIso && normalizeMerchantForDedup(t.name) === itemNorm && Math.abs(t.amount - item.amount) < 0.01;
  });

  return match
    ? { isDuplicate: true, duplicateOf: match.id, reason: "exact_duplicate", confidence: "exact" }
    : { isDuplicate: false };
}

/**
 * Visible safe-import label for an import-preview row.
 *
 * Mapping rules:
 *   NEW_SAFE_TO_IMPORT       — no duplicate signal of any kind
 *   EXACT_DUPLICATE_SKIP     — exact match (same date + name + amount); auto-recommended skip
 *   POSTING_DATE_MATCH_REVIEW — fuzzy ±1–2 day window with first-word merchant match (expense)
 *   POSSIBLE_DUPLICATE_REVIEW — fuzzy income match or batch-internal duplicate
 *   CONFLICT_REVIEW          — same-amount/date but mismatched name OR pending-vs-posted
 */
export type SafeImportLabel =
  | "NEW_SAFE_TO_IMPORT"
  | "EXACT_DUPLICATE_SKIP"
  | "POSTING_DATE_MATCH_REVIEW"
  | "POSSIBLE_DUPLICATE_REVIEW"
  | "CONFLICT_REVIEW";

export function getSafeImportLabel(item: ImportPreviewItem): SafeImportLabel {
  if (!item.isDuplicate) return "NEW_SAFE_TO_IMPORT";

  // Exact duplicate (same date + name + amount, exact confidence) → skip
  if (item.duplicateConfidence === "exact" && item.duplicateReason === "exact_duplicate") {
    return "EXACT_DUPLICATE_SKIP";
  }

  // Within-batch identical row → conflict (user must decide)
  if (item.duplicateReason === "batch_exact_duplicate") return "CONFLICT_REVIEW";

  // Pending-vs-posted match or same-amount-merchant-window → conflict review
  if (
    item.duplicateReason === "pending_to_posted_match" ||
    item.duplicateReason === "same_amount_same_merchant_date_window"
  ) {
    return "CONFLICT_REVIEW";
  }

  // Posting-date offset (±1–2 days, first-word match) on EXPENSE → posting-date label
  if (item.duplicateReason === "posting_date_match" && item.txType === "expense") {
    return "POSTING_DATE_MATCH_REVIEW";
  }

  // Any remaining fuzzy signal (e.g. fuzzy income) → possible duplicate review
  return "POSSIBLE_DUPLICATE_REVIEW";
}

export function runRulesEngine(
  rawItems: RawTransaction[],
  userRules: Rule[],
  existingTransactions: Transaction[]
): ImportPreviewItem[] {
  const results: ImportPreviewItem[] = [];
  const seenInBatch = new Map<string, string>();

  for (const item of rawItems) {
    const txType = item.txType === "income" && isKnownExpenseMerchant(item.name, item.amount) ? "expense" : item.txType ?? "expense";

    // Within-batch exact duplicate detection — expense only.
    // Income rows (e.g., multiple Amazon transfers of the same amount on the same day)
    // are intentionally not batch-deduped because they can be legitimate repeated deposits.
    const batchKey = `${item.date}|${item.name.toLowerCase().trim()}|${item.amount}|${txType}`;
    let batchDupOf: string | undefined;
    if (txType === "expense") {
      if (seenInBatch.has(batchKey)) {
        batchDupOf = seenInBatch.get(batchKey);
      } else {
        seenInBatch.set(batchKey, item.date + "_" + item.name);
      }
    }

    // Cross-import duplicate detection (against existing Firestore rows)
    const existingDup =
      txType === "income"
        ? isDuplicateIncome(item, existingTransactions)   // exact-only; protects repeated legitimate transfers
        : isDuplicateExpense(item, existingTransactions); // exact + fuzzy ±2-day posting-offset window

    const duplicate = existingDup.isDuplicate || !!batchDupOf;
    const dupReason: DuplicateReason | undefined = batchDupOf
      ? "batch_exact_duplicate"
      : existingDup.reason;
    const dupConfidence = batchDupOf ? "exact" : existingDup.confidence;

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
        duplicateOf: existingDup.duplicateOf ?? batchDupOf,
        duplicateReason: dupReason,
        duplicateConfidence: dupConfidence,
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
      duplicateOf: existingDup.duplicateOf ?? batchDupOf,
      duplicateReason: dupReason,
      duplicateConfidence: dupConfidence,
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
