/**
 * Browser-safe inlined copy of the April 2026 verified manual audit fixture.
 * Used to compare Firestore rows against the expected 151-row dataset and
 * identify which rows are missing, extra, or misclassified.
 *
 * Source of truth: __fixtures__/april2026-audit-*.source.txt (verified by tests).
 */
import { normalizeLedgerDate, normalizeLedgerMerchant } from "./ledgerEngine";
import type { FinalLedgerTransaction } from "./ledgerEngine";
import type { Transaction } from "./types";

export interface AprilFixtureRow {
  date: string;       // YYYY-MM-DD
  name: string;
  amount: number;     // positive
  expectedType: "income" | "expense";
  expectedCategory: string;
}

// ─── 32 verified income rows ─────────────────────────────────────────────────
export const APRIL_INCOME_FIXTURE: AprilFixtureRow[] = [
  { date: "2026-04-01", name: "Amazon transfer",        amount: 26.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-02", name: "Walmart.com return",     amount: 13.59,   expectedType: "income", expectedCategory: "Other Income" },
  { date: "2026-04-02", name: "Amazon transfer",        amount: 76.00,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-03", name: "Hobby Lobby payroll",    amount: 1125.68, expectedType: "income", expectedCategory: "Payroll" },
  { date: "2026-04-03", name: "Amazon transfer",        amount: 92.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-03", name: "James Bly transfer",     amount: 350.00,  expectedType: "income", expectedCategory: "Cash Transfer" },
  { date: "2026-04-06", name: "Amazon transfer",        amount: 109.50,  expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-06", name: "Amazon transfer",        amount: 69.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-06", name: "Amazon transfer",        amount: 29.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-06", name: "Amazon transfer",        amount: 154.50,  expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-09", name: "Shipt pay",              amount: 14.49,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-13", name: "Amazon transfer",        amount: 92.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-13", name: "Amazon transfer",        amount: 104.50,  expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-13", name: "Amazon transfer",        amount: 109.50,  expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-14", name: "Amazon transfer",        amount: 76.00,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-15", name: "Progressive refund",     amount: 12.63,   expectedType: "income", expectedCategory: "Other Income" },
  { date: "2026-04-17", name: "Hobby Lobby payroll",    amount: 827.74,  expectedType: "income", expectedCategory: "Payroll" },
  { date: "2026-04-17", name: "Amazon return",          amount: 42.53,   expectedType: "income", expectedCategory: "Other Income" },
  { date: "2026-04-17", name: "Amazon transfer",        amount: 28.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-17", name: "Cash transfer",          amount: 325.00,  expectedType: "income", expectedCategory: "Cash Transfer" },
  { date: "2026-04-20", name: "Google One refund",      amount: 1.69,    expectedType: "income", expectedCategory: "Other Income" },
  { date: "2026-04-20", name: "Amazon transfer",        amount: 101.00,  expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-20", name: "Amazon transfer",        amount: 95.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-20", name: "Amazon transfer",        amount: 113.50,  expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-20", name: "Amazon transfer",        amount: 76.00,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-20", name: "Amazon transfer",        amount: 23.00,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-20", name: "Amazon transfer",        amount: 77.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-20", name: "Amazon transfer",        amount: 83.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-21", name: "Amazon transfer",        amount: 29.50,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-22", name: "Netflix reversal",       amount: 28.61,   expectedType: "income", expectedCategory: "Other Income" },
  { date: "2026-04-23", name: "Amazon transfer",        amount: 76.00,   expectedType: "income", expectedCategory: "Gig Work" },
  { date: "2026-04-23", name: "Amazon transfer",        amount: 76.00,   expectedType: "income", expectedCategory: "Gig Work" },
];

// ─── 119 verified spending rows ───────────────────────────────────────────────
export const APRIL_SPEND_FIXTURE: AprilFixtureRow[] = [
  { date: "2026-04-02", name: "Freddy's",                          amount: 11.18,  expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-02", name: "Flex Finance / rent + water",       amount: 442.78, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-02", name: "Medical Pain Center",               amount: 39.06,  expectedType: "expense", expectedCategory: "Medical" },
  { date: "2026-04-02", name: "Club Car Wash",                     amount: 15.00,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-02", name: "Amazon",                            amount: 41.43,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-02", name: "Cash App car repair",               amount: 140.00, expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-02", name: "McDonald's",                        amount: 11.70,  expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-02", name: "Walmart.com",                       amount: 16.16,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-02", name: "Shell Weatherford",                 amount: 36.55,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-02", name: "Replit",                            amount: 20.00,  expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-02", name: "Save As You Go",                    amount: 6.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-02", name: "Walmart.com",                       amount: 69.55,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-03", name: "Ongo Express",                      amount: 7.16,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-03", name: "Save As You Go",                    amount: 2.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-03", name: "Google Gridwise",                   amount: 10.59,  expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-03", name: "McDonald's",                        amount: 5.84,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-06", name: "Oklahoma Motor",                    amount: 290.00, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-06", name: "Dave Inc",                          amount: 415.00, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-06", name: "Walmart Supercenter",               amount: 44.45,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-06", name: "QT Inside",                         amount: 4.33,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-06", name: "Lemonade Insurance",                amount: 10.42,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-06", name: "Amazon Grocery",                    amount: 7.47,   expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-06", name: "Casey's",                           amount: 39.47,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-06", name: "OnCue",                             amount: 19.33,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-06", name: "Save As You Go",                    amount: 7.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-07", name: "Hobby Lobby vending",               amount: 3.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-07", name: "Emergency Service / Cedar",         amount: 31.00,  expectedType: "expense", expectedCategory: "Medical" },
  { date: "2026-04-07", name: "Save As You Go",                    amount: 3.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-07", name: "Amazon Grocery",                    amount: 2.00,   expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-07", name: "Coldstone",                         amount: 11.64,  expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-07", name: "Hobby Lobby vending",               amount: 3.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-08", name: "Hobby Lobby vending",               amount: 1.25,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-08", name: "Hobby Lobby vending",               amount: 1.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-08", name: "OG&E",                              amount: 75.50,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-08", name: "Walgreens",                         amount: 14.03,  expectedType: "expense", expectedCategory: "Medical" },
  { date: "2026-04-08", name: "Walgreens",                         amount: 11.64,  expectedType: "expense", expectedCategory: "Medical" },
  { date: "2026-04-08", name: "Fresh Clips",                       amount: 38.00,  expectedType: "expense", expectedCategory: "Shopping" },
  { date: "2026-04-08", name: "Save As You Go",                    amount: 6.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-08", name: "Dave fee",                          amount: 1.00,   expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-09", name: "Wells Fargo Reflect payment",       amount: 75.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-09", name: "Wells Fargo Active Cash payment",   amount: 100.00, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-09", name: "Amazon Marketplace",                amount: 46.89,  expectedType: "expense", expectedCategory: "Shopping" },
  { date: "2026-04-09", name: "Synchrony payment",                 amount: 75.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-09", name: "Walmart.com",                       amount: 45.27,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-09", name: "Affirm",                            amount: 20.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-09", name: "Save As You Go",                    amount: 1.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-10", name: "Affirm",                            amount: 30.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-10", name: "Walmart.com",                       amount: 3.93,   expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-13", name: "ChatGPT",                           amount: 21.19,  expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-13", name: "OnCue",                             amount: 2.16,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-13", name: "Pyrvia",                            amount: 40.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-13", name: "Replit",                            amount: 50.05,  expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-13", name: "Amazon",                            amount: 14.24,  expectedType: "expense", expectedCategory: "Shopping" },
  { date: "2026-04-13", name: "Walmart",                           amount: 39.73,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-13", name: "OnCue",                             amount: 34.86,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-13", name: "OnCue",                             amount: 42.87,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-13", name: "Google One",                        amount: 2.11,   expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-13", name: "Amazon",                            amount: 2.73,   expectedType: "expense", expectedCategory: "Shopping" },
  { date: "2026-04-13", name: "Prime Video",                       amount: 5.99,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-13", name: "T-Mobile",                          amount: 80.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-13", name: "Cursor",                            amount: 20.00,  expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-13", name: "Save As You Go",                    amount: 10.00,  expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-13", name: "WF Loan / auto pay",                amount: 181.39, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-13", name: "Dollar General",                    amount: 20.99,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-14", name: "Save As You Go",                    amount: 1.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-14", name: "Hobby Lobby vending",               amount: 1.25,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-15", name: "Save As You Go",                    amount: 2.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-15", name: "Store Oklahoma City",               amount: 9.77,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-15", name: "Hobby Lobby vending",               amount: 4.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-16", name: "Amazon Marketplace",                amount: 42.53,  expectedType: "expense", expectedCategory: "Shopping" },
  { date: "2026-04-16", name: "Hobby Lobby vending",               amount: 1.25,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-16", name: "US Dept of Education",              amount: 37.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-16", name: "Save As You Go",                    amount: 4.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-16", name: "Walmart",                           amount: 14.49,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-16", name: "Flexible Finance",                  amount: 14.99,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-17", name: "Hobby Lobby vending",               amount: 1.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-17", name: "Hobby Lobby vending",               amount: 2.75,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-17", name: "Hobby Lobby vending",               amount: 1.25,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-17", name: "Prime Video",                       amount: 3.99,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-17", name: "Amazon",                            amount: 32.78,  expectedType: "expense", expectedCategory: "Shopping" },
  { date: "2026-04-17", name: "Store Oklahoma City",               amount: 7.59,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-17", name: "Save As You Go",                    amount: 7.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-17", name: "Planet Fitness",                    amount: 21.75,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-17", name: "OnCue",                             amount: 25.39,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-17", name: "Wells Fargo Active Cash payment",   amount: 100.00, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-20", name: "Hobby Lobby vending",               amount: 1.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-20", name: "Integris",                          amount: 50.00,  expectedType: "expense", expectedCategory: "Medical" },
  { date: "2026-04-20", name: "Dave Inc",                          amount: 370.25, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-20", name: "QT Inside",                         amount: 4.33,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-20", name: "Oklahoma Motor",                    amount: 290.00, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-20", name: "Hobby Lobby vending",               amount: 0.75,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-20", name: "Google One",                        amount: 4.23,   expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-20", name: "SanerAI / LEMSQZY",                 amount: 5.00,   expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-20", name: "QT Outside",                        amount: 37.05,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-20", name: "Walmart+",                          amount: 12.95,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-20", name: "McDonald's",                        amount: 9.77,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-20", name: "Pyrvia",                            amount: 40.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-20", name: "Affirm",                            amount: 30.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-20", name: "OnCue",                             amount: 39.65,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-20", name: "OnCue",                             amount: 4.33,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-20", name: "Wells Fargo Active Cash payment",   amount: 50.00,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-20", name: "Save As You Go",                    amount: 11.00,  expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-21", name: "Whataburger",                       amount: 11.18,  expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-21", name: "Save As You Go",                    amount: 3.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-21", name: "Hobby Lobby vending",               amount: 1.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-21", name: "Hobby Lobby vending",               amount: 1.00,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-22", name: "Netflix",                           amount: 28.61,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-22", name: "Flex Finance rent",                 amount: 378.25, expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-23", name: "Papa's Trading",                    amount: 5.62,   expectedType: "expense", expectedCategory: "Waste" },
  { date: "2026-04-23", name: "Medical Pain Center",               amount: 24.96,  expectedType: "expense", expectedCategory: "Medical" },
  { date: "2026-04-23", name: "Amazon Marketplace",                amount: 51.20,  expectedType: "expense", expectedCategory: "Shopping" },
  { date: "2026-04-23", name: "Save As You Go",                    amount: 4.00,   expectedType: "expense", expectedCategory: "Transfers" },
  { date: "2026-04-23", name: "Walmart.com",                       amount: 57.60,  expectedType: "expense", expectedCategory: "Necessary" },
  { date: "2026-04-23", name: "Papa's Trading",                    amount: 43.01,  expectedType: "expense", expectedCategory: "Fuel" },
  { date: "2026-04-24", name: "OpenAI",                            amount: 5.00,   expectedType: "expense", expectedCategory: "Work" },
  { date: "2026-04-24", name: "Amazon Prime",                      amount: 14.99,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-24", name: "Google Coursera",                   amount: 63.59,  expectedType: "expense", expectedCategory: "Bills" },
  { date: "2026-04-24", name: "Chick-fil-A",                       amount: 11.29,  expectedType: "expense", expectedCategory: "Waste" },
];

export const ALL_APRIL_FIXTURE_ROWS: AprilFixtureRow[] = [
  ...APRIL_INCOME_FIXTURE,
  ...APRIL_SPEND_FIXTURE,
];

// ─── Comparison helpers ───────────────────────────────────────────────────────

/**
 * Match a Firestore transaction against a fixture row.
 * Matches on: normalized ISO date + amount within $0.01 cents.
 * Name is intentionally NOT used for matching because bank descriptions
 * differ from the fixture merchant names.
 */
function rowsMatch(tx: { date: string; amount: number }, fixture: AprilFixtureRow): boolean {
  const isoDate = normalizeLedgerDate(tx.date);
  const sameDate = isoDate === fixture.date;
  const sameAmt = Math.abs(Math.abs(tx.amount) - fixture.amount) < 0.011;
  return sameDate && sameAmt;
}

export interface ComparisonResult {
  /** Fixture rows that have NO matching Firestore row (missing from Firestore entirely). */
  missingFromFirestore: AprilFixtureRow[];
  /** Firestore rows that match NO fixture row (extra / unexpected rows). */
  extraInFirestore: Array<Transaction | FinalLedgerTransaction>;
  /** Rows that match on date+amount but have a different stored type vs fixture type. */
  wrongStoredType: Array<{
    fixture: AprilFixtureRow;
    tx: Transaction | FinalLedgerTransaction;
    storedType: string;
    expectedType: string;
  }>;
  /** Rows that match but engine changes type away from what fixture expects. */
  wrongEngineType: Array<{
    fixture: AprilFixtureRow;
    tx: FinalLedgerTransaction;
    engineType: string;
    expectedType: string;
    typeReason: string;
  }>;
}

/**
 * Compare the actual Firestore rows (passed through the engine) against the
 * 151-row April fixture.
 */
export function compareToFixture(
  finalRows: FinalLedgerTransaction[],
  rawRows: (Transaction | FinalLedgerTransaction)[],
): ComparisonResult {
  const fixture = ALL_APRIL_FIXTURE_ROWS;

  // For each fixture row, find a matching Firestore row (date + amount).
  // Allow multiple fixture rows to match the same Firestore row (e.g. two
  // Amazon transfers for $76 on the same day).
  const usedRawIds = new Set<string>();

  const missingFromFirestore: AprilFixtureRow[] = [];

  for (const f of fixture) {
    const match = rawRows.find(
      (tx) => !usedRawIds.has(tx.id) && rowsMatch(tx, f),
    );
    if (match) {
      usedRawIds.add(match.id);
    } else {
      missingFromFirestore.push(f);
    }
  }

  // Extra rows: Firestore rows that matched nothing in the fixture
  const allMatchedIds = new Set<string>();
  for (const f of fixture) {
    const match = rawRows.find((tx) => rowsMatch(tx, f));
    if (match) allMatchedIds.add(match.id);
  }
  const extraInFirestore = rawRows.filter((tx) => !allMatchedIds.has(tx.id));

  // Wrong stored type: matched pairs where storedType ≠ fixture expectedType
  const wrongStoredType: ComparisonResult["wrongStoredType"] = [];
  for (const f of fixture) {
    const match = rawRows.find((tx) => rowsMatch(tx, f));
    if (!match) continue;
    const stored = (match as Transaction).type ?? "expense";
    if (stored !== f.expectedType) {
      wrongStoredType.push({
        fixture: f,
        tx: match,
        storedType: stored,
        expectedType: f.expectedType,
      });
    }
  }

  // Wrong engine type: matched pairs where final engine type ≠ fixture expectedType
  const wrongEngineType: ComparisonResult["wrongEngineType"] = [];
  for (const f of fixture) {
    const match = finalRows.find((tx) => rowsMatch(tx, f));
    if (!match) continue;
    if (match.type !== f.expectedType) {
      wrongEngineType.push({
        fixture: f,
        tx: match,
        engineType: match.type ?? "expense",
        expectedType: f.expectedType,
        typeReason: match.typeReason ?? "unknown",
      });
    }
  }

  return { missingFromFirestore, extraInFirestore, wrongStoredType, wrongEngineType };
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function buildRowsCSV(
  rawRows: (Transaction | FinalLedgerTransaction)[],
  finalRows: FinalLedgerTransaction[],
): string {
  const finalById = new Map(finalRows.map((r) => [r.id, r]));
  const fixtureMatchInfo = buildFixtureMatchMap(rawRows);

  const header = [
    "id", "date", "month", "name", "amount", "signedAmount",
    "storedType", "engineType", "typeReason",
    "storedCategory", "engineCategory", "categoryReason",
    "status", "isDuplicate", "duplicateKey",
    "fixtureMatch", "fixtureExpectedType", "fixtureExpectedCategory",
    "includeReason",
  ].join(",");

  const rows = rawRows.map((tx) => {
    const final = finalById.get(tx.id);
    const fmatch = fixtureMatchInfo.get(tx.id);
    const signed = tx.type === "income" ? Math.abs(tx.amount) : -Math.abs(tx.amount);
    const dupKey = final
      ? [normalizeLedgerDate(tx.date), normalizeLedgerMerchant(tx.name),
         Math.abs(tx.amount).toFixed(2), final.type ?? "expense"].join("|")
      : "";
    return [
      esc(tx.id),
      esc(normalizeLedgerDate(tx.date)),
      esc(tx.month ?? ""),
      esc(tx.name),
      esc(Math.abs(tx.amount).toFixed(2)),
      esc(signed.toFixed(2)),
      esc(tx.type ?? "expense"),
      esc(final?.type ?? "(excluded)"),
      esc(final?.typeReason ?? ""),
      esc(tx.category ?? ""),
      esc(final?.category ?? "(excluded)"),
      esc(final?.categoryReason ?? ""),
      esc(tx.status ?? ""),
      esc(tx.isDuplicate ?? false),
      esc(dupKey),
      esc(fmatch ? "YES" : "NO"),
      esc(fmatch?.expectedType ?? ""),
      esc(fmatch?.expectedCategory ?? ""),
      esc(final ? "INCLUDED" : "EXCLUDED-duplicate"),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

function buildFixtureMatchMap(
  rawRows: (Transaction | FinalLedgerTransaction)[],
): Map<string, AprilFixtureRow> {
  const result = new Map<string, AprilFixtureRow>();
  const used = new Set<number>();
  for (const tx of rawRows) {
    const idx = ALL_APRIL_FIXTURE_ROWS.findIndex(
      (f, i) => !used.has(i) && rowsMatch(tx, f),
    );
    if (idx >= 0) {
      result.set(tx.id, ALL_APRIL_FIXTURE_ROWS[idx]);
      used.add(idx);
    }
  }
  return result;
}

export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
