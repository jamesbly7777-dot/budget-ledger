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
import { detectIncomeCategory, getCategoryForTransaction, isKnownExpenseMerchant, runRulesEngine } from "./rulesEngine";
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
});
