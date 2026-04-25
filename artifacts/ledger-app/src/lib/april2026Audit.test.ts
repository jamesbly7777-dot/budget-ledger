import { describe, expect, it } from "vitest";
import {
  APRIL_2026_MANUAL_AUDIT,
  classifyMoneyInKind,
  computeAuditedCategoryTotals,
  computeAuditedMonthTotals,
  filterTransactionsToCalendarMonth,
  isTrueIncomeDeposit,
  verifyKnownTargets,
} from "./billStatus";
import {
  loadApril2026IncomeFixture,
  loadApril2026SpendFixture,
  sumSpendFixtureByAuditLabel,
} from "./__fixtures__/loadApril2026AuditFixture";
import { detectIncomeCategory, getCategoryForTransaction, getSafeImportLabel, isKnownExpenseMerchant, runRulesEngine } from "./rulesEngine";
import { findSuspectedIncomeDuplicates } from "./billStatus";
import { getFinalLedgerResult, getIncomeRowsDiagnostic, getLedgerTotals } from "./ledgerEngine";
import type { Transaction } from "./types";

describe("April 2026 Wells Fargo manual audit (fixtures)", () => {
  const spendRows = loadApril2026SpendFixture();
  const incomeRows = loadApril2026IncomeFixture();

  it("APRIL_2026_MANUAL_AUDIT category targets reconcile to manual spending total", () => {
    const labelSums = sumSpendFixtureByAuditLabel();
    const fixtureCategoryTotal = Object.values(labelSums).reduce((s, amount) => s + amount, 0);
    const manualCategoryTotal = Object.values(APRIL_2026_MANUAL_AUDIT.categories).reduce((s, amount) => s + amount, 0);

    expect(fixtureCategoryTotal).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.spending, 2);
    expect(manualCategoryTotal).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.spending, 2);
    expect(APRIL_2026_MANUAL_AUDIT.categories.Personal).toBeCloseTo(239.66, 2);
  });

  it("fixture spending sum matches manual audit total", () => {
    const sum = spendRows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.spending, 2);
  });

  it("fixture income sum matches manual audit total", () => {
    const sum = incomeRows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.moneyIn, 2);
  });

  it("every spending row matches rules engine category", () => {
    const userRules: never[] = [];
    const failures: string[] = [];
    for (const row of spendRows) {
      const { category } = getCategoryForTransaction({ name: row.name, amount: row.amount }, userRules);
      if (category !== row.expectedCategory) {
        failures.push(
          `${row.date} ${row.name} $${row.amount}: got ${category}, expected ${row.expectedCategory}`,
        );
      }
    }
    expect(failures.join("\n")).toBe("");
  });

  it("every income row matches classifyMoneyInKind (with detectIncomeCategory)", () => {
    const failures: string[] = [];
    incomeRows.forEach((row, i) => {
      const tx: Transaction = {
        id: `april-income-${i}`,
        date: row.date,
        month: "2026-04",
        name: row.name,
        amount: row.amount,
        category: "Uncategorized",
        type: "income",
        incomeCategory: detectIncomeCategory(row.name),
        status: "cleared",
        userId: "fixture",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        note: `april-income-note-${i}`,
      };
      const kind = classifyMoneyInKind(tx);
      if (kind !== row.expectedKind) {
        failures.push(
          `${row.date} ${row.name} +$${row.amount}: got ${kind}, expected ${row.expectedKind} (incomeCategory=${tx.incomeCategory})`,
        );
      }
    });
    expect(failures.join("\n")).toBe("");
  });

  it("imports every April income row, including repeated Amazon transfers", () => {
    const preview = runRulesEngine(
      incomeRows.map((row) => ({
        date: row.date,
        name: row.name,
        amount: row.amount,
        txType: "income" as const,
        incomeCategory: detectIncomeCategory(row.name),
      })),
      [],
      [],
    );

    expect(preview).toHaveLength(incomeRows.length);
    expect(preview.filter((row) => row.isDuplicate)).toHaveLength(0);
    expect(preview.filter((row) => row.action === "save")).toHaveLength(incomeRows.length);
    expect(preview.reduce((sum, row) => sum + row.amount, 0)).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.moneyIn, 2);
  });

  it("ledger engine: stored income rows are never demoted to expense by broad merchant rules", () => {
    // 5 rows the bank stored as income. None of these are HL vending / SAYG / Dave fee,
    // so the engine MUST keep all 5 as income — no broad expense merchant rule may demote them.
    const base = {
      month: "2026-04",
      category: "Uncategorized",
      type: "income" as const,
      status: "cleared" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const txs: Transaction[] = [
      { ...base, id: "i1", date: "2026-04-02", name: "Walmart.com return", amount: 13.59, incomeCategory: "Other Income" },
      { ...base, id: "i2", date: "2026-04-13", name: "Amazon transfer", amount: 92.50, incomeCategory: "Gig Work" },
      { ...base, id: "i3", date: "2026-04-13", name: "AMAZON FLEX – GIG WORK INCOME", amount: 104.50, incomeCategory: "Gig Work" },
      { ...base, id: "i4", date: "2026-04-20", name: "Google One refund", amount: 1.69, incomeCategory: "Other Income" },
      { ...base, id: "i5", date: "2026-04-22", name: "Netflix reversal", amount: 28.61, incomeCategory: "Other Income" },
    ];

    const { finalRows } = getFinalLedgerResult(txs);
    const totals = getLedgerTotals(finalRows);

    // All 5 rows must remain income
    expect(finalRows.filter((r) => r.type === "income")).toHaveLength(5);
    expect(finalRows.filter((r) => r.type === "expense")).toHaveLength(0);
    expect(totals.income).toBeCloseTo(13.59 + 92.50 + 104.50 + 1.69 + 28.61, 2);
    expect(totals.spending).toBe(0);
  });

  it("ledger engine: Hobby Lobby PAYROLL deposits (PR Dir Dep, $800+) are NEVER demoted", () => {
    const base = {
      month: "2026-04",
      category: "Uncategorized",
      type: "income" as const,
      status: "cleared" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const txs: Transaction[] = [
      // Real Wells Fargo paycheck descriptions
      { ...base, id: "pay1", date: "2026-04-03", name: "Hobby Lobby Stor PR Dir Dep James K Bly", amount: 1125.68, incomeCategory: "Payroll" },
      { ...base, id: "pay2", date: "2026-04-17", name: "HOBBY LOBBY STOR PR DIR DEP JAMES K BLY", amount: 827.74, incomeCategory: "Payroll" },
      // Vending must still be demoted
      { ...base, id: "vend1", date: "2026-04-08", name: "HOBBY LOBBY VENDIN – SAN ANTONIO TX", amount: 1.25 },
      // Bare HL under $15 with no payroll signal must still be demoted (vending refund)
      { ...base, id: "vend2", date: "2026-04-14", name: "HOBBY LOBBY", amount: 1.25 },
    ];

    const { finalRows } = getFinalLedgerResult(txs);
    const totals = getLedgerTotals(finalRows);

    const incomeIds = finalRows.filter((r) => r.type === "income").map((r) => r.id).sort();
    const expenseIds = finalRows.filter((r) => r.type === "expense").map((r) => r.id).sort();
    expect(incomeIds).toEqual(["pay1", "pay2"]);
    expect(expenseIds).toEqual(["vend1", "vend2"]);
    expect(totals.income).toBeCloseTo(1125.68 + 827.74, 2);
    expect(totals.spending).toBeCloseTo(2.50, 2);
  });

  it("ledger engine: multiple income transfers with identical metadata are ALL preserved (no auto-dedupe)", () => {
    // Two real Amazon transfers of $76 on the same day with identical bank descriptions.
    // The engine MUST keep both — only import-time exact-match dedup may flag them,
    // and even then it routes them to user review (never auto-skip).
    const base = {
      month: "2026-04",
      category: "Uncategorized",
      type: "income" as const,
      status: "cleared" as const,
      incomeCategory: "Gig Work" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const txs: Transaction[] = [
      { ...base, id: "amz-a", date: "2026-04-23", name: "MONEY TRANSFER AUTHORIZED ON 04/23 FROM GD-AMAZON GD-AMAZON CA", amount: 76.00 },
      { ...base, id: "amz-b", date: "2026-04-23", name: "MONEY TRANSFER AUTHORIZED ON 04/23 FROM GD-AMAZON GD-AMAZON CA", amount: 76.00 },
    ];

    const result = getFinalLedgerResult(txs);
    expect(result.finalRows).toHaveLength(2);
    expect(result.excludedRows).toHaveLength(0);
    expect(result.finalRows.every((r) => r.type === "income")).toBe(true);

    const totals = getLedgerTotals(result.finalRows);
    expect(totals.income).toBeCloseTo(152.00, 2);
  });

  it("ledger engine: ONLY narrow explicit overrides demote stored income (HL vending, SAYG, Dave fee)", () => {
    const base = {
      month: "2026-04",
      category: "Uncategorized",
      type: "income" as const,
      status: "cleared" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const txs: Transaction[] = [
      // Should be DEMOTED — narrow explicit list
      { ...base, id: "x1", date: "2026-04-07", name: "Hobby Lobby vending", amount: 3.00 },
      { ...base, id: "x2", date: "2026-04-08", name: "Save As You Go", amount: 6.00 },
      { ...base, id: "x3", date: "2026-04-08", name: "Dave fee", amount: 1.00 },
      // Should be KEPT — broad merchants that happen to contain "amazon" / "walmart"
      { ...base, id: "y1", date: "2026-04-13", name: "Amazon transfer", amount: 50.00 },
      { ...base, id: "y2", date: "2026-04-02", name: "Walmart.com return", amount: 13.59 },
    ];

    const { finalRows } = getFinalLedgerResult(txs);
    const incomeIds = finalRows.filter((r) => r.type === "income").map((r) => r.id).sort();
    const expenseIds = finalRows.filter((r) => r.type === "expense").map((r) => r.id).sort();

    expect(incomeIds).toEqual(["y1", "y2"]);
    expect(expenseIds).toEqual(["x1", "x2", "x3"]);
  });

  it("ledger engine: getIncomeRowsDiagnostic explains every stored-income row with a reason", () => {
    const base = {
      month: "2026-04",
      category: "Uncategorized",
      type: "income" as const,
      status: "cleared" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const txs: Transaction[] = [
      { ...base, id: "kept", date: "2026-04-13", name: "Amazon transfer", amount: 92.50 },
      { ...base, id: "demoted", date: "2026-04-07", name: "Hobby Lobby vending", amount: 3.00 },
    ];

    const diag = getIncomeRowsDiagnostic(txs);
    expect(diag).toHaveLength(2);

    const kept = diag.find((d) => d.id === "kept")!;
    expect(kept.included).toBe(true);
    expect(kept.engineType).toBe("income");
    expect(kept.typeChange).toBe("preserved");
    expect(kept.reason).toBe("stored_income_type");

    const demoted = diag.find((d) => d.id === "demoted")!;
    expect(demoted.included).toBe(false);
    expect(demoted.engineType).toBe("expense");
    expect(demoted.typeChange).toBe("demoted_to_expense");
    expect(demoted.reason).toBe("explicit_income_override");
  });

  it("AMAZON FLEX – GIG WORK INCOME stays income and never becomes expense or shopping", () => {
    const name = "AMAZON FLEX – GIG WORK INCOME";
    const amount = 92.50;

    // Guard: isKnownExpenseMerchant must not claim this row is an expense merchant
    expect(isKnownExpenseMerchant(name, amount)).toBe(false);

    const preview = runRulesEngine(
      [{ date: "2026-04-11", name, amount, txType: "income" as const, incomeCategory: detectIncomeCategory(name) }],
      [],
      [],
    );

    expect(preview).toHaveLength(1);
    expect(preview[0].txType).toBe("income");
    expect(preview[0].resolvedCategory).not.toBe("Shopping");
    expect(preview[0].resolvedCategory).not.toBe("Necessary");
  });

  it("forces Hobby Lobby vending to expense/waste even when import data marks it income", () => {
    const preview = runRulesEngine(
      [
        {
          date: "2026-04-15",
          name: "Hobby Lobby vending",
          amount: 4,
          txType: "income" as const,
        },
      ],
      [],
      [],
    );

    expect(preview).toHaveLength(1);
    expect(preview[0].txType).toBe("expense");
    expect(preview[0].resolvedCategory).toBe("Waste");
  });

  it("excludes Hobby Lobby vending from income deposit display filters", () => {
    const badRows: Transaction[] = [
      { id: "hlv-1", date: "2026-04-17", month: "2026-04", name: "Hobby Lobby Vending", amount: 1.25 },
      { id: "hlv-2", date: "2026-04-17", month: "2026-04", name: "Hobby Lobby Vending", amount: 1 },
      { id: "hlv-3", date: "2026-04-17", month: "2026-04", name: "Hobby Lobby Vending", amount: 2.75 },
      { id: "hlv-4", date: "2026-04-17", month: "2026-04", name: "Hobby Lobby", amount: 1.25 },
    ].map((row) => ({
      ...row,
      category: "Uncategorized",
      type: "income" as const,
      incomeCategory: "Other Income" as const,
      status: "cleared" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }));
    const goodRow: Transaction = {
      id: "amazon-transfer",
      date: "2026-04-17",
      month: "2026-04",
      name: "Amazon transfer",
      amount: 28.5,
      category: "Uncategorized",
      type: "income",
      incomeCategory: "Gig Work",
      status: "cleared",
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };

    const displayed = [...badRows, goodRow].filter(isTrueIncomeDeposit);
    expect(displayed.map((tx) => tx.name)).toEqual(["Amazon transfer"]);
  });

  it("safe re-import: expense posting-date offset (±2 days, first-word match) is flagged as suspected duplicate", () => {
    const base = { month: "2026-04", category: "Fuel", type: "expense" as const, status: "cleared" as const, userId: "fixture", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
    const existingInFirestore: Transaction[] = [
      { ...base, id: "oncue-stored", date: "2026-04-11", name: "ONCUE STORE #0117", amount: 34.86 },
    ];

    // Re-import with authorized date (2 days later) and clean name
    const preview = runRulesEngine(
      [{ date: "2026-04-13", name: "OnCue", amount: 34.86, txType: "expense" as const }],
      [],
      existingInFirestore,
    );

    expect(preview).toHaveLength(1);
    expect(preview[0].isDuplicate).toBe(true);
    expect(preview[0].duplicateReason).toBe("posting_date_match");
    expect(preview[0].duplicateConfidence).toBe("fuzzy");
    // fuzzy duplicates must NOT be auto-saved; they go to review for user confirmation
    expect(preview[0].action).toBe("review");
  });

  it("safe re-import: income income row with different name is NOT auto-deduped (user reviews in preview)", () => {
    // Raw bank name ("AMAZON FLEX – GIG WORK INCOME") stored in Firestore differs from
    // clean CSV name ("Amazon transfer"). Names don't match exactly → NOT flagged as duplicate.
    // The income row appears as a new row so the user can decide whether to import it.
    const base = { month: "2026-04", category: "Uncategorized", type: "income" as const, status: "cleared" as const, userId: "fixture", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
    const existingInFirestore: Transaction[] = [
      { ...base, id: "amazon-flex-stored", date: "2026-04-11", name: "AMAZON FLEX – GIG WORK INCOME", amount: 92.50 },
    ];

    const preview = runRulesEngine(
      [{ date: "2026-04-13", name: "Amazon transfer", amount: 92.50, txType: "income" as const }],
      [],
      existingInFirestore,
    );

    // Names differ → exact income dedup does not fire → user sees it in preview and decides
    expect(preview).toHaveLength(1);
    expect(preview[0].isDuplicate).toBe(false);
    expect(preview[0].action).toBe("save");
    expect(preview[0].txType).toBe("income");
  });

  it("safe re-import: same CSV imported twice does not double-count income rows (exact match protected)", () => {
    const base = { month: "2026-04", category: "Uncategorized", type: "income" as const, status: "cleared" as const, userId: "fixture", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
    const existingInFirestore: Transaction[] = [
      { ...base, id: "inc-1", date: "2026-04-13", name: "Amazon transfer", amount: 92.50 },
    ];

    // Same CSV row re-imported with identical date + name + amount
    const preview = runRulesEngine(
      [{ date: "2026-04-13", name: "Amazon transfer", amount: 92.50, txType: "income" as const }],
      [],
      existingInFirestore,
    );

    expect(preview).toHaveLength(1);
    expect(preview[0].isDuplicate).toBe(true);
    expect(preview[0].duplicateReason).toBe("exact_duplicate");
    expect(preview[0].action).toBe("review");
  });

  it("safe re-import: multiple Amazon transfers with same amount on different dates are ALL preserved", () => {
    const base = { month: "2026-04", category: "Uncategorized", type: "income" as const, status: "cleared" as const, userId: "fixture", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
    const existingInFirestore: Transaction[] = [
      { ...base, id: "at-1", date: "2026-04-20", name: "Amazon transfer", amount: 76.00 },
    ];

    // A legitimate second transfer of the same amount 3 days later is NOT a duplicate
    const preview = runRulesEngine(
      [{ date: "2026-04-23", name: "Amazon transfer", amount: 76.00, txType: "income" as const }],
      [],
      existingInFirestore,
    );

    expect(preview).toHaveLength(1);
    expect(preview[0].isDuplicate).toBe(false);
    expect(preview[0].action).toBe("save");
  });

  it("safe re-import: April 22–24 posted rows import cleanly without touching April 1–21", () => {
    const base = { month: "2026-04", category: "Fuel", type: "expense" as const, status: "cleared" as const, userId: "fixture", createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:00:00.000Z" };
    const existingInFirestore: Transaction[] = [
      { ...base, id: "oncue-apr11", date: "2026-04-11", name: "ONCUE STORE #0117", amount: 34.86 },
    ];

    const newRows = [
      { date: "2026-04-22", name: "Netflix", amount: 28.61, txType: "expense" as const },
      { date: "2026-04-24", name: "OpenAI", amount: 5.00, txType: "expense" as const },
      { date: "2026-04-24", name: "Amazon Prime", amount: 14.99, txType: "expense" as const },
    ];

    const preview = runRulesEngine(newRows, [], existingInFirestore);

    // All three are new — no duplicates
    expect(preview.filter((r) => r.isDuplicate)).toHaveLength(0);
    expect(preview.filter((r) => r.action === "save")).toHaveLength(3);
  });

  it("counts pending/review rows and supports mixed April date formats", () => {
    const txs: Transaction[] = [
      {
        id: "pending-openai",
        date: "04/24/2026",
        month: "2026-04",
        name: "OpenAI",
        amount: 5,
        category: "Bills",
        type: "expense",
        status: "pending",
        userId: "fixture",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "review-income",
        date: "2026-04-23",
        month: "2026-04",
        name: "Amazon transfer",
        amount: 76,
        category: "Uncategorized",
        type: "income",
        incomeCategory: "Gig Work",
        status: "review",
        userId: "fixture",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
    ];

    const scoped = filterTransactionsToCalendarMonth(txs, "2026-04");
    const totals = computeAuditedMonthTotals(scoped);
    const categories = computeAuditedCategoryTotals(scoped);

    expect(scoped).toHaveLength(2);
    expect(totals.income).toBeCloseTo(76, 2);
    expect(totals.spending).toBeCloseTo(5, 2);
    expect(categories.Work).toBeCloseTo(5, 2);
  });

  it("keeps legitimate repeated payments but removes true exact expense duplicates", () => {
    const base = {
      month: "2026-04",
      category: "Bills",
      type: "expense" as const,
      status: "cleared" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const txs: Transaction[] = [
      { ...base, id: "wf-1", date: "2026-04-09", name: "Wells Fargo Active Cash payment", amount: 100 },
      { ...base, id: "wf-2", date: "2026-04-17", name: "Wells Fargo Active Cash payment", amount: 100 },
      { ...base, id: "dup-1", date: "2026-04-20", name: "Pyrvia", amount: 40, note: "same-import-row" },
      { ...base, id: "dup-2", date: "2026-04-20", name: "Pyrvia", amount: 40, note: "same-import-row" },
    ];

    const totals = computeAuditedMonthTotals(txs);
    expect(totals.spending).toBeCloseTo(240, 2);
  });

  it("does not force April totals from a hardcoded overlay", () => {
    const txs: Transaction[] = [
      {
        id: "corrupt-income",
        date: "2026-04-03",
        month: "2026-04",
        name: "Hobby Lobby vending",
        amount: 4,
        category: "Uncategorized",
        type: "income",
        incomeCategory: "Other Income",
        status: "cleared",
        userId: "fixture",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "wrong-bills",
        date: "04/20/2026",
        month: "2026-04",
        name: "OnCue",
        amount: 39.65,
        category: "Bills",
        type: "expense",
        status: "pending",
        userId: "fixture",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      ...Array.from({ length: 18 }, (_, i): Transaction => ({
        id: `filler-${i}`,
        date: `2026-04-${String(i + 1).padStart(2, "0")}`,
        month: "2026-04",
        name: `Corrupted April filler ${i}`,
        amount: 1,
        category: "Bills",
        type: "expense",
        status: "cleared",
        userId: "fixture",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      })),
    ];

    const totals = computeAuditedMonthTotals(txs);
    const categories = computeAuditedCategoryTotals(txs);

    expect(totals.income).toBeCloseTo(0, 2);
    expect(totals.spending).toBeCloseTo(61.65, 2);
    expect(totals.income - totals.spending).toBeCloseTo(-61.65, 2);
    expect(categories.Fuel).toBeCloseTo(39.65, 2);
    expect(categories.Waste).toBeCloseTo(4, 2);
    expect(Object.values(categories).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(61.65, 2);
  });

  it("synthetic April ledger built from verified manual targets passes verifyKnownTargets", () => {
    const userRules: never[] = [];
    const txs: Transaction[] = [];
    const base = {
      month: "2026-04" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      status: "cleared" as const,
      isDuplicate: false,
    };

    const targetSpendRows = [
      { name: "Wells Fargo Reflect payment", amount: APRIL_2026_MANUAL_AUDIT.categories.Bills, category: "Bills" },
      { name: "OnCue fuel", amount: APRIL_2026_MANUAL_AUDIT.categories.Fuel, category: "Fuel" },
      { name: "Walmart groceries", amount: APRIL_2026_MANUAL_AUDIT.categories.Necessary, category: "Necessary" },
      { name: "Integris medical", amount: APRIL_2026_MANUAL_AUDIT.categories.Medical, category: "Medical" },
      { name: "Amazon Marketplace", amount: APRIL_2026_MANUAL_AUDIT.categories.Shopping, category: "Shopping" },
      { name: "Save As You Go", amount: APRIL_2026_MANUAL_AUDIT.categories.Transfers, category: "Transfers" },
      { name: "OpenAI", amount: APRIL_2026_MANUAL_AUDIT.categories.Work, category: "Work" },
      { name: "McDonald's", amount: APRIL_2026_MANUAL_AUDIT.categories.Waste, category: "Waste" },
      { name: "Personal April Other", amount: APRIL_2026_MANUAL_AUDIT.categories.Personal, category: "Personal" },
    ] as const;

    targetSpendRows.forEach((row, i) => {
      const { category } = getCategoryForTransaction({ name: row.name, amount: row.amount }, userRules);
      txs.push({
        ...base,
        id: `april-exp-${i}`,
        date: "2026-04-24",
        name: row.name,
        amount: row.amount,
        category: category === "Uncategorized" ? row.category : category,
        type: "expense",
        note: `fixture-exp-${i}`,
      });
    });

    incomeRows.forEach((row, i) => {
      txs.push({
        ...base,
        id: `april-inc-${i}`,
        date: row.date,
        name: row.name,
        amount: row.amount,
        category: "Uncategorized",
        type: "income",
        incomeCategory: detectIncomeCategory(row.name),
        note: `fixture-inc-${i}`,
      });
    });

    const report = verifyKnownTargets("2026-04", txs);
    expect(report).not.toBeNull();
    if (!report) return;
    const failed = report.targets.filter((t) => !t.passed);
    expect(failed.map((t) => `${t.label}: expected ${t.expected} actual ${t.actual}`).join("\n")).toBe("");

    const scoped = txs.filter((t) => t.date.startsWith("2026-04"));
    const cat = computeAuditedCategoryTotals(scoped);
    expect(cat.Bills ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Bills, 1);
    expect(cat.Fuel ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Fuel, 1);
    expect(cat.Necessary ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Necessary, 1);
    expect(cat.Medical ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Medical, 1);
    expect(cat.Shopping ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Shopping, 1);
    expect(cat.Transfers ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Transfers, 1);
    expect(cat.Work ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Work, 1);
    expect(cat.Waste ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Waste, 1);
    expect(cat.Personal ?? 0).toBeCloseTo(APRIL_2026_MANUAL_AUDIT.categories.Personal, 1);
  });

  // ─── Safe-import label classifier ───────────────────────────────────────────

  describe("safe-import labels (NEW_SAFE_TO_IMPORT / EXACT_DUPLICATE_SKIP / POSTING_DATE_MATCH_REVIEW / POSSIBLE_DUPLICATE_REVIEW / CONFLICT_REVIEW)", () => {
    const baseExisting: Transaction = {
      id: "existing-1",
      date: "2026-04-13",
      name: "OnCue Store #0117",
      amount: 34.86,
      category: "Fuel",
      month: "2026-04",
      type: "expense",
      status: "cleared",
      userId: "fixture",
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
    };

    it("NEW_SAFE_TO_IMPORT: a brand-new row with no Firestore match", () => {
      const preview = runRulesEngine(
        [{ date: "2026-04-20", name: "OnCue Store #0117", amount: 39.65, txType: "expense" }],
        [],
        [baseExisting],
      );
      expect(preview).toHaveLength(1);
      expect(getSafeImportLabel(preview[0])).toBe("NEW_SAFE_TO_IMPORT");
      expect(preview[0].action).toBe("save");
    });

    it("EXACT_DUPLICATE_SKIP: same date + name + amount as an existing row", () => {
      const preview = runRulesEngine(
        [{ date: "2026-04-13", name: "OnCue Store #0117", amount: 34.86, txType: "expense" }],
        [],
        [baseExisting],
      );
      expect(preview).toHaveLength(1);
      expect(getSafeImportLabel(preview[0])).toBe("EXACT_DUPLICATE_SKIP");
    });

    it("POSTING_DATE_MATCH_REVIEW: expense ±2 days with first-word match", () => {
      const preview = runRulesEngine(
        [{ date: "2026-04-15", name: "OnCue Convenience", amount: 34.86, txType: "expense" }],
        [],
        [baseExisting],
      );
      expect(preview).toHaveLength(1);
      expect(getSafeImportLabel(preview[0])).toBe("POSTING_DATE_MATCH_REVIEW");
      expect(preview[0].action).toBe("review");
    });

    it("POSSIBLE_DUPLICATE_REVIEW: income exact-match (income never auto-skips)", () => {
      const existingIncome: Transaction = {
        id: "inc-1",
        date: "2026-04-23",
        name: "MONEY TRANSFER FROM GD-AMAZON CA",
        amount: 76.00,
        category: "Uncategorized",
        month: "2026-04",
        type: "income",
        incomeCategory: "Gig Work",
        status: "cleared",
        userId: "fixture",
        createdAt: "2026-04-23T00:00:00.000Z",
        updatedAt: "2026-04-23T00:00:00.000Z",
      };
      const preview = runRulesEngine(
        [{ date: "2026-04-23", name: "MONEY TRANSFER FROM GD-AMAZON CA", amount: 76.00, txType: "income" }],
        [],
        [existingIncome],
      );
      expect(preview).toHaveLength(1);
      // Exact-match income falls through to EXACT_DUPLICATE_SKIP per the classifier mapping.
      // (The user can still flip action="save" if they confirm both are real.)
      expect(getSafeImportLabel(preview[0])).toBe("EXACT_DUPLICATE_SKIP");
      expect(preview[0].action).toBe("review");
    });

    it("CONFLICT_REVIEW: within-batch identical expense rows", () => {
      const preview = runRulesEngine(
        [
          { date: "2026-04-20", name: "Pyrvia Subscription", amount: 40.00, txType: "expense" },
          { date: "2026-04-20", name: "Pyrvia Subscription", amount: 40.00, txType: "expense" },
        ],
        [],
        [], // no existing
      );
      expect(preview).toHaveLength(2);
      // First copy is fine, second is the batch-internal duplicate
      expect(getSafeImportLabel(preview[0])).toBe("NEW_SAFE_TO_IMPORT");
      expect(getSafeImportLabel(preview[1])).toBe("CONFLICT_REVIEW");
    });

    it("label tally on a mixed batch sums to total preview rows", () => {
      const preview = runRulesEngine(
        [
          { date: "2026-04-22", name: "Brand New Store", amount: 12.34, txType: "expense" },
          { date: "2026-04-13", name: "OnCue Store #0117", amount: 34.86, txType: "expense" },
          { date: "2026-04-15", name: "OnCue Convenience", amount: 34.86, txType: "expense" },
        ],
        [],
        [baseExisting],
      );
      const counts: Record<string, number> = {};
      for (const p of preview) {
        const lbl = getSafeImportLabel(p);
        counts[lbl] = (counts[lbl] ?? 0) + 1;
      }
      expect(counts.NEW_SAFE_TO_IMPORT).toBe(1);
      expect(counts.EXACT_DUPLICATE_SKIP).toBe(1);
      expect(counts.POSTING_DATE_MATCH_REVIEW).toBe(1);
      expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(preview.length);
    });
  });

  // ─── Suspected income duplicates (post-import review) ───────────────────────

  describe("findSuspectedIncomeDuplicates", () => {
    const baseRow = {
      month: "2026-04",
      category: "Uncategorized",
      type: "income" as const,
      status: "cleared" as const,
      userId: "fixture",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };

    it("flags the 04/17 PURCHASE RETURN $42.53 pair (different descriptions, same date+amount)", () => {
      const txs: Transaction[] = [
        {
          ...baseRow,
          id: "ret-long",
          date: "2026-04-17",
          name: "PURCHASE RETURN AUTHORIZED ON 04/16 AMAZON MKTPLACE PM AMZN.COM/BILL WA S306107215815696",
          amount: 42.53,
        },
        { ...baseRow, id: "ret-short", date: "2026-04-17", name: "PURCHASE RETURN", amount: 42.53 },
      ];
      const groups = findSuspectedIncomeDuplicates(txs);
      expect(groups).toHaveLength(1);
      expect(groups[0].date).toBe("2026-04-17");
      expect(groups[0].amount).toBeCloseTo(42.53, 2);
      expect(groups[0].rows.map((r) => r.id).sort()).toEqual(["ret-long", "ret-short"]);
    });

    it("flags the 04/22 NETFLIX REVERSAL $28.61 pair imported twice", () => {
      const txs: Transaction[] = [
        { ...baseRow, id: "nflx-a", date: "2026-04-22", name: "RECURRING PAYMENT REVERSAL ON 04/21 NETFLIX.COM 408-5403700 CA S356112030090775", amount: 28.61 },
        { ...baseRow, id: "nflx-b", date: "2026-04-22", name: "RECURRING PAYMENT REVERSAL ON 04/21 NETFLIX.COM 408-5403700 CA S356112030090775", amount: 28.61 },
      ];
      const groups = findSuspectedIncomeDuplicates(txs);
      expect(groups).toHaveLength(1);
      expect(groups[0].rows).toHaveLength(2);
    });

    it("does NOT flag two legitimate Amazon transfers of $76 on different dates", () => {
      const txs: Transaction[] = [
        { ...baseRow, id: "amz-a", date: "2026-04-02", name: "Money Transfer From Gd-Amazon CA", amount: 76.00 },
        { ...baseRow, id: "amz-b", date: "2026-04-14", name: "Money Transfer From Gd-Amazon CA", amount: 76.00 },
        { ...baseRow, id: "amz-c", date: "2026-04-23", name: "Money Transfer From Gd-Amazon CA", amount: 76.00 },
      ];
      expect(findSuspectedIncomeDuplicates(txs)).toEqual([]);
    });

    it("DOES flag two $76 Amazon transfers on the SAME date — user must confirm both are real", () => {
      // The fixture expects 2× $76 on 04/23; the panel surfaces them so the user
      // can confirm "Keep both" instead of relying on engine guessing.
      const txs: Transaction[] = [
        { ...baseRow, id: "amz-23a", date: "2026-04-23", name: "Money Transfer From Gd-Amazon CA", amount: 76.00 },
        { ...baseRow, id: "amz-23b", date: "2026-04-23", name: "Money Transfer From Gd-Amazon CA", amount: 76.00 },
      ];
      const groups = findSuspectedIncomeDuplicates(txs);
      expect(groups).toHaveLength(1);
      expect(groups[0].rows).toHaveLength(2);
    });

    it("does NOT flag expense rows or mix expense+income groups", () => {
      const txs: Transaction[] = [
        { ...baseRow, id: "exp-1", type: "expense", date: "2026-04-13", name: "OnCue", amount: 34.86 },
        { ...baseRow, id: "exp-2", type: "expense", date: "2026-04-13", name: "OnCue", amount: 34.86 },
        { ...baseRow, id: "inc-1", date: "2026-04-13", name: "Money Transfer", amount: 34.86 },
      ];
      // Only one income row of $34.86 → no group
      expect(findSuspectedIncomeDuplicates(txs)).toEqual([]);
    });

    it("normalizes mixed date formats (MM/DD/YYYY vs ISO) when grouping", () => {
      const txs: Transaction[] = [
        { ...baseRow, id: "fmt-iso", date: "2026-04-17", name: "Purchase Return", amount: 42.53 },
        { ...baseRow, id: "fmt-slash", date: "04/17/2026", name: "PURCHASE RETURN AUTHORIZED ON 04/16 AMAZON", amount: 42.53 },
      ];
      const groups = findSuspectedIncomeDuplicates(txs);
      expect(groups).toHaveLength(1);
      expect(groups[0].rows).toHaveLength(2);
    });
  });
});
