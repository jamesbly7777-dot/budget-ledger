import { CyberHero } from "@/components/CyberHero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTransactions, useBills, useRepairTransactions, useTransactionSourceCounts, useDeleteTransaction } from "@/hooks/use-finance";
import { useToast } from "@/hooks/use-toast";
import { computeIncomeTotals } from "@/lib/firestoreService";
import { Loader2, TrendingUp, TrendingDown, Activity, ShieldAlert, ShieldCheck, AlertTriangle, CalendarClock, Wrench, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMonthKey } from "@/lib/rulesEngine";
import {
  billsForBillManagerMonth,
  isEffectivelyPaidInMonth,
  computeBillManagerMonthTotals,
  computeAuditedMonthTotals,
  computeAuditedCategoryTotals,
  buildMonthAuditReport,
  filterAuditedTransactions,
  filterTransactionsToCalendarMonth,
  isTrueIncomeDeposit,
  verifyKnownTargets,
  findSuspectedIncomeDuplicates,
} from "@/lib/billStatus";
import {
  getLedgerDiagnostics,
  getFinalLedgerResult,
  normalizeLedgerDate,
  getIncomeRowsDiagnostic,
  getDashboardInclusionDiagnostics,
  type DashboardInclusionRow,
} from "@/lib/ledgerEngine";
import {
  compareToFixture,
  buildRowsCSV,
  downloadCSV,
} from "@/lib/aprilFixtureCompare";
import { useState, useMemo } from "react";

const APRIL_EXPECTED = {
  income: 4462.46,
  spending: 4880.32,
};

function pickRowsForDelta(rows: DashboardInclusionRow[], target: number): DashboardInclusionRow[] {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount);
  const picked: DashboardInclusionRow[] = [];
  let remaining = Math.round(target * 100);
  for (const row of sorted) {
    const cents = Math.round(row.amount * 100);
    if (remaining <= 0) break;
    if (cents <= remaining) {
      picked.push(row);
      remaining -= cents;
    }
  }
  return picked;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function includedReasonForRow(row: DashboardInclusionRow): string {
  if (!row.includedInDashboard) return `excluded:${row.exclusionReason ?? "unknown"}`;
  if (row.status === "review") return "included_active_review";
  if (row.status === "pending") return "included_active_pending";
  if (row.source === "manual_bill" || row.source === "linked_bill") return "included_manual_or_linked";
  if (row.source === "imported_bank_transaction") return "included_imported_bank_transaction";
  return "included_active_cleared";
}

const CATEGORY_DISPLAY: Record<string, string> = {
  Bills: "Bills / Debt",
  Fuel: "Fuel / Work",
  Necessary: "Necessary Living",
  Medical: "Medical",
  Shopping: "Shopping",
  Transfers: "Transfers / Savings",
  Personal: "Personal",
  Waste: "Waste",
  Work: "Work / AI Tools",
  Uncategorized: "Uncategorized",
};

const INCOME_SOURCE_COLORS: Record<string, string> = {
  Payroll: "text-blue-400",
  "Gig Work": "text-purple-400",
  "Cash Transfer": "text-cyan-400",
  "Side Business": "text-orange-400",
  "Other Income": "text-emerald-300",
};

export default function DashboardPage({ selectedMonth }: { selectedMonth: string }) {
  const monthKey = selectedMonth || getMonthKey(new Date());
  const { data: transactions, isLoading: txLoading } = useTransactions(monthKey);
  const { data: bills, isLoading: billsLoading } = useBills();
  const repairMutation = useRepairTransactions();
  const { data: sourceCounts, refetch: refetchSourceCounts } = useTransactionSourceCounts(monthKey);
  const deleteTxMutation = useDeleteTransaction();
  const { toast } = useToast();
  const [diagExpanded, setDiagExpanded] = useState(false);
  // Track which suspected-duplicate groups the user has marked "Keep Both"
  const [keptDuplicateGroups, setKeptDuplicateGroups] = useState<Set<string>>(new Set());

  // ALL derived state + memos must be declared before any conditional return
  const txs = transactions || [];
  const monthTxs = filterTransactionsToCalendarMonth(txs, monthKey);
  const isAprilAudit = monthKey === "2026-04";

  const fixtureComparison = useMemo(() => {
    if (!isAprilAudit || monthTxs.length === 0) return null;
    const { finalRows } = getFinalLedgerResult(monthTxs);
    return compareToFixture(finalRows, monthTxs);
  }, [isAprilAudit, monthTxs]);

  const incomeDiagnostic = useMemo(() => {
    if (monthTxs.length === 0) return [];
    return getIncomeRowsDiagnostic(monthTxs);
  }, [monthTxs]);

  const dashboardDiag = useMemo(() => getDashboardInclusionDiagnostics(monthTxs), [monthTxs]);

  const suspectedIncomeDuplicates = useMemo(
    () => findSuspectedIncomeDuplicates(monthTxs),
    [monthTxs],
  );

  if (txLoading || billsLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const diag = getLedgerDiagnostics(monthTxs);

  function handleExportCSV() {
    const { finalRows } = getFinalLedgerResult(monthTxs);
    const csv = buildRowsCSV(monthTxs, finalRows);
    downloadCSV(csv, `april-2026-rows-${Date.now()}.csv`);
  }

  const auditedTxs = filterAuditedTransactions(monthTxs);
  const {
    income: cashFlowMoneyIn,
    spending: totalSpending,
    earnedIncome,
    refundReversalIn,
    transferIn,
    otherMoneyIn,
  } = computeAuditedMonthTotals(monthTxs);
  const expenses = auditedTxs.filter((t) => !t.type || t.type === "expense");
  const income = auditedTxs.filter(isTrueIncomeDeposit);
  const net = cashFlowMoneyIn - totalSpending;

  const categoryTotals = computeAuditedCategoryTotals(monthTxs);
  const incomeTotals = computeIncomeTotals(auditedTxs);
  const incomeSources = Object.entries(incomeTotals).filter(([, amount]) => amount > 0);
  const audit = buildMonthAuditReport(monthTxs);
  const targetsReport = verifyKnownTargets(monthKey, monthTxs);
  const incomeOverBy = Math.max(0, Number((dashboardDiag.sumIncludedIncome - APRIL_EXPECTED.income).toFixed(2)));
  const spendingOverBy = Math.max(0, Number((dashboardDiag.sumIncludedSpending - APRIL_EXPECTED.spending).toFixed(2)));
  const extraIncomeRows = pickRowsForDelta(
    dashboardDiag.includedRows.filter((r) => r.engineType === "income"),
    incomeOverBy,
  );
  const extraSpendingRows = pickRowsForDelta(
    dashboardDiag.includedRows.filter((r) => r.engineType !== "income"),
    spendingOverBy,
  );
  const spendingRows = dashboardDiag.rows.filter((r) => r.engineType !== "income");
  const includedSpendingRows = spendingRows.filter((r) => r.includedInDashboard);
  const excludedSpendingRows = spendingRows.filter((r) => !r.includedInDashboard);
  const rawSpendingTotal = round2(spendingRows.reduce((s, r) => s + r.amount, 0));
  const includedSpendingTotal = round2(includedSpendingRows.reduce((s, r) => s + r.amount, 0));
  const excludedSpendingTotal = round2(excludedSpendingRows.reduce((s, r) => s + r.amount, 0));
  const spendingDiffFromExpected = round2(includedSpendingTotal - APRIL_EXPECTED.spending);

  const spendingFixtureDelta = (() => {
    if (!isAprilAudit || !fixtureComparison) return null;
    const includedIds = new Set(includedSpendingRows.map((r) => r.id));
    const extraSpendingRows = fixtureComparison.extraInFirestore
      .filter((tx) => ((tx.type ?? "expense") !== "income") && includedIds.has(tx.id))
      .map((tx) => ({
        id: tx.id,
        date: tx.date,
        name: tx.name,
        amount: Math.abs(tx.amount),
        source: tx.source ?? "—",
      }));
    const missingSpendingRows = fixtureComparison.missingFromFirestore
      .filter((f) => f.expectedType === "expense")
      .map((f) => ({
        id: `missing:${f.date}:${f.amount}:${f.name}`,
        date: f.date,
        name: f.name,
        amount: f.amount,
        source: "fixture_missing",
      }));
    const extraTotal = round2(extraSpendingRows.reduce((s, r) => s + r.amount, 0));
    const missingTotal = round2(missingSpendingRows.reduce((s, r) => s + r.amount, 0));
    const netDelta = round2(extraTotal - missingTotal);
    const overageCandidates = pickRowsForDelta(
      extraSpendingRows.map((r) => ({
        id: r.id,
        date: r.date,
        name: r.name,
        amount: r.amount,
        postedDate: undefined,
        storedType: "expense",
        engineType: "expense",
        category: "—",
        status: "cleared",
        isDuplicate: false,
        includedInDashboard: true,
        source: r.source,
      })),
      Math.max(0, spendingDiffFromExpected),
    ).map((r) => ({ id: r.id, date: r.date, name: r.name, amount: r.amount }));
    return {
      extraSpendingRows,
      missingSpendingRows,
      extraTotal,
      missingTotal,
      netDelta,
      overageCandidates,
    };
  })();

  

  const includedSpendingBySignature = (() => {
    const buckets = new Map<string, number>();
    includedSpendingRows.forEach((r) => {
      const sig = `${r.date}|${r.amount.toFixed(2)}|${r.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()}`;
      buckets.set(sig, (buckets.get(sig) ?? 0) + 1);
    });
    return Array.from(buckets.entries())
      .filter(([, count]) => count > 1)
      .map(([signature, count]) => ({ signature, count }))
      .slice(0, 20);
  })();



  const today = new Date();
  const todayDay = today.getDate();

  // Bills that actually apply to this month (same set as Bill Manager) — not every bill in the database
  const overviewBills = billsForBillManagerMonth(bills || [], monthKey);
  const billTotals = computeBillManagerMonthTotals(bills || [], monthKey, auditedTxs);
  const billsTotal = billTotals.totalAmount;
  const billsPaid = billTotals.paidAmount;
  const safeToSpend = earnedIncome - billsTotal;
  const billsCoverageRate = earnedIncome > 0 && billsTotal > 0 ? Math.min((earnedIncome / billsTotal) * 100, 999) : null;
  const isCovered = earnedIncome >= billsTotal && billsTotal > 0;

  // Upcoming / overdue: same month as Overview + ledger match for “paid” (txs are already for monthKey)
  const unpaidThisMonth = overviewBills.filter((b) => !isEffectivelyPaidInMonth(b, monthKey, auditedTxs));
  const upcomingBills = unpaidThisMonth
    .map((b) => ({ ...b, daysUntil: b.dueDay >= todayDay ? b.dueDay - todayDay : 32 - todayDay + b.dueDay }))
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 6);
  const overdueBills = unpaidThisMonth.filter((b) => b.dueDay < todayDay);

  const topWaste = auditedTxs
    .filter((t) => !t.type || t.type === "expense")
    .filter((t) => t.category === "Waste")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const recentTxs = [...auditedTxs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  const incomeDeposits = [...auditedTxs].filter(isTrueIncomeDeposit).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  return (
    <div className="space-y-6">
      <CyberHero compact />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="surface-tech">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Money In (cash flow)</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-400">${cashFlowMoneyIn.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {income.length} deposit{income.length !== 1 ? "s" : ""} · earned ${earnedIncome.toFixed(2)} · refunds ${refundReversalIn.toFixed(2)} · transfers ${transferIn.toFixed(2)}
              {otherMoneyIn > 0.01 ? ` · other $${otherMoneyIn.toFixed(2)}` : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="surface-tech">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Spending</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-400">${totalSpending.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{expenses.length} transaction{expenses.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>

        <Card className="surface-tech">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Net Cash Flow</CardTitle>
            <Activity className={`h-4 w-4 ${net >= 0 ? "text-emerald-400" : "text-destructive"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${net >= 0 ? "text-emerald-400" : "text-destructive"}`}>
              {net >= 0 ? "+" : ""}${net.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{net >= 0 ? "Surplus" : "Deficit"} this month</p>
          </CardContent>
        </Card>

        <Card
          className={`border-2 backdrop-blur-xl ${
            billsTotal === 0
              ? "surface-tech border-cyan-500/15"
              : isCovered
                ? "border-emerald-400/35 bg-emerald-500/[0.07] shadow-[0_0_40px_-16px_hsl(145_70%_45%_/_.25)]"
                : "border-red-400/35 bg-red-500/[0.07] shadow-[0_0_40px_-16px_hsl(350_85%_50%_/_.2)]"
          }`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Bill Coverage</CardTitle>
            {billsTotal === 0 ? <ShieldAlert className="h-4 w-4 text-muted-foreground" /> : isCovered ? <ShieldCheck className="h-4 w-4 text-green-400" /> : <ShieldAlert className="h-4 w-4 text-red-400" />}
          </CardHeader>
          <CardContent>
            {billsTotal === 0 ? (
              <>
                <div className="text-2xl font-bold font-mono text-muted-foreground">—</div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">No bills tracked</p>
              </>
            ) : (
              <>
                <div className={`text-2xl font-bold font-mono ${isCovered ? "text-green-400" : "text-red-400"}`}>
                  {billsCoverageRate !== null ? `${billsCoverageRate.toFixed(0)}%` : "—"}
                </div>
                <p className={`text-xs mt-1 font-mono ${safeToSpend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {safeToSpend >= 0 ? `+$${safeToSpend.toFixed(2)} after bills` : `-$${Math.abs(safeToSpend).toFixed(2)} short`}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {upcomingBills.length > 0 && (
        <Card className="surface-tech">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono uppercase tracking-wider text-sm flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary drop-shadow-[0_0_8px_hsl(187_100%_50%_/_.4)]" /> Upcoming Bills
              {overdueBills.length > 0 && (
                <span className="ml-2 flex items-center gap-1 text-red-400 text-xs font-mono">
                  <AlertTriangle className="w-3.5 h-3.5" /> {overdueBills.length} overdue
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {upcomingBills.map((bill) => {
                const isOverdue = bill.dueDay < todayDay;
                const isDueToday = bill.dueDay === todayDay;
                const isDueSoon = bill.daysUntil <= 3 && !isOverdue;
                const dueDateObj = new Date(today.getFullYear(), today.getMonth(), bill.dueDay);
                const formattedDate = dueDateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div key={bill.id} className={`flex items-center gap-3 px-6 py-3 ${isOverdue ? "bg-red-500/5" : isDueToday ? "bg-yellow-500/5" : ""}`}>
                    <div className="w-16 text-center">
                      <span className={`font-mono text-sm font-bold ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : "text-emerald-400"}`}>
                        {formattedDate}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm truncate">{bill.name}</p>
                      <p className={`text-xs font-mono ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : isDueSoon ? "text-orange-400" : "text-muted-foreground"}`}>
                        {isOverdue ? `${todayDay - bill.dueDay}d overdue` : isDueToday ? "Due today" : `Due in ${bill.daysUntil}d`}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-sm">${bill.amount.toFixed(2)}</span>
                    {(isOverdue || isDueToday) && (
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${isOverdue ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                        {isOverdue ? "OVERDUE" : "TODAY"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="surface-tech border-orange-500/25">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono uppercase tracking-wider text-sm flex items-center gap-2 text-orange-300">
            <Activity className="w-4 h-4" /> Audit Report — {monthKey}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Income (raw → audited)</p>
              <p className="font-mono text-sm text-emerald-400">${audit.rawIncome.toFixed(2)} → ${audit.auditedIncome.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Spending (raw → audited)</p>
              <p className="font-mono text-sm text-red-400">${audit.rawSpending.toFixed(2)} → ${audit.auditedSpending.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Confirmed Removed</p>
              <p className="font-mono text-sm text-orange-300">${audit.confirmedDuplicateAmountRemoved.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Pending rows</p>
              <p className="font-mono text-sm text-muted-foreground">
                {audit.excludedPendingCount} pending (counted in totals) · marked dup {audit.excludedDuplicateCount} · split children {audit.excludedSplitCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Duplicates</p>
              <p className="font-mono text-sm text-yellow-400">
                strict {audit.strictDuplicateExpenseIds.length} · suspected groups {audit.duplicateGroupCount} · income dup {audit.duplicateIncomeCandidateIds.length}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Manual bill merged (no double count)</p>
              <p className="font-mono text-sm text-orange-300">{audit.manualBillMergedIds.length}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Overcounted Bills</p>
              <p className="font-mono text-sm text-orange-300">{audit.overcountedBills.length}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Manual vs Imported Conflicts</p>
              <p className="font-mono text-sm text-orange-300">{audit.manualImportedConflicts.length}</p>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-muted-foreground">Recurring Overages</p>
              <p className="font-mono text-sm text-orange-300">{audit.recurringOverages.length}</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Excluded Rows List (sample)</p>
            <div className="max-h-28 overflow-y-auto space-y-1">
              {audit.excludedRows.slice(0, 8).map((row) => (
                <div key={row.id} className="text-[11px] font-mono text-muted-foreground flex items-center justify-between gap-2">
                  <span className="truncate">{row.date} — {row.name} ({row.reason})</span>
                  <span className="text-orange-300">${row.amount.toFixed(2)}</span>
                </div>
              ))}
              {audit.excludedRows.length === 0 && (
                <p className="text-[11px] font-mono text-muted-foreground/70">No excluded rows for this month.</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Inclusion table totals (month)</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs font-mono">
              <div className="rounded border border-emerald-500/25 bg-emerald-500/5 p-2">
                Included income: <span className="text-emerald-300">${dashboardDiag.sumIncludedIncome.toFixed(2)}</span>
              </div>
              <div className="rounded border border-zinc-500/25 bg-zinc-500/5 p-2">
                Excluded income: <span className="text-zinc-300">${dashboardDiag.sumExcludedIncome.toFixed(2)}</span>
              </div>
              <div className="rounded border border-red-500/25 bg-red-500/5 p-2">
                Included spending: <span className="text-red-300">${dashboardDiag.sumIncludedSpending.toFixed(2)}</span>
              </div>
              <div className="rounded border border-zinc-500/25 bg-zinc-500/5 p-2">
                Excluded spending: <span className="text-zinc-300">${dashboardDiag.sumExcludedSpending.toFixed(2)}</span>
              </div>
              <div className="rounded border border-cyan-500/25 bg-cyan-500/5 p-2">
                Included rows: <span className="text-cyan-300">{dashboardDiag.countIncludedRows}</span>
              </div>
              <div className="rounded border border-zinc-500/25 bg-zinc-500/5 p-2">
                Excluded rows: <span className="text-zinc-300">{dashboardDiag.countExcludedRows}</span>
              </div>
            </div>
          </div>
          {monthKey === "2026-04" && (
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase text-muted-foreground">
                Current April overcount candidates — Income +${incomeOverBy.toFixed(2)} / Spending +${spendingOverBy.toFixed(2)}
              </p>
              <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2">
                <p className="text-[10px] font-mono uppercase text-amber-300 mb-1">Income overcount rows (candidate list)</p>
                {extraIncomeRows.length === 0 ? (
                  <p className="text-[11px] font-mono text-muted-foreground">No candidate rows found.</p>
                ) : (
                  extraIncomeRows.map((r) => (
                    <div key={r.id} className="text-[11px] font-mono flex items-center justify-between gap-2 border-b border-border/20 pb-1">
                      <span className="truncate">{r.date} — {r.name}</span>
                      <span className="text-emerald-300">${r.amount.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2">
                <p className="text-[10px] font-mono uppercase text-amber-300 mb-1">Spending overcount rows (candidate list)</p>
                {extraSpendingRows.length === 0 ? (
                  <p className="text-[11px] font-mono text-muted-foreground">No candidate rows found.</p>
                ) : (
                  extraSpendingRows.map((r) => (
                    <div key={r.id} className="text-[11px] font-mono flex items-center justify-between gap-2 border-b border-border/20 pb-1">
                      <span className="truncate">{r.date} — {r.name}</span>
                      <span className="text-red-300">${r.amount.toFixed(2)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {targetsReport && (
        <Card className="surface-tech border-cyan-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono uppercase tracking-wider text-sm text-cyan-300">
              April 2026 — Manual audit vs app (validation)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[11px] font-mono text-muted-foreground">
              Compares your Wells Fargo manual totals to the cleaned ledger pipeline (±$0.55). Reclassify or merge duplicates until rows align.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-mono text-muted-foreground uppercase">Manual reference spending</p>
                <p className="font-mono text-sm">${targetsReport.baselineSpending.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground uppercase">App audited spending</p>
                <p className="font-mono text-sm text-emerald-400">${targetsReport.actualAuditedSpending.toFixed(2)}</p>
              </div>
            </div>
            <div className="space-y-1">
              {targetsReport.targets.map((t) => (
                <div key={t.key} className="flex items-center justify-between text-xs font-mono border-b border-border/30 pb-1">
                  <span className={t.passed ? "text-emerald-300" : "text-red-300"}>
                    {t.passed ? "PASS" : "FAIL"} · {t.label}
                  </span>
                  <span className="text-muted-foreground">
                    actual ${t.actual.toFixed(2)}
                    {t.expected !== null ? ` / expected $${t.expected.toFixed(2)}` : " · expected: manual"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pipeline Diagnostics + Data Repair ─────────────────────────────── */}
      <Card className="surface-tech border-amber-500/30">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono uppercase tracking-wider text-sm text-amber-300 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Pipeline Diagnostics — {monthKey}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                onClick={() => repairMutation.mutate(monthKey, { onSettled: () => refetchSourceCounts() })}
                disabled={repairMutation.isPending}
              >
                {repairMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Wrench className="w-3 h-3 mr-1" />}
                Repair DB Rows
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
                onClick={handleExportCSV}
              >
                ↓ Export Rows CSV
              </Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setDiagExpanded((v) => !v)}>
                {diagExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {repairMutation.isSuccess && (
            <div className="text-xs font-mono text-emerald-400 bg-emerald-900/20 rounded p-2">
              Repair complete — scanned {repairMutation.data.scanned} rows, repaired {repairMutation.data.repaired}:
              {" "}month field fixed {repairMutation.data.monthFixed},
              type reclassified {repairMutation.data.typeFixed},
              category updated {repairMutation.data.categoryFixed},
              duplicate flag cleared {repairMutation.data.duplicateFlagCleared}.
              Reload in 3s…
            </div>
          )}
          {repairMutation.isError && (
            <div className="text-xs font-mono text-red-400 bg-red-900/20 rounded p-2">
              Repair failed: {String(repairMutation.error)}
            </div>
          )}
          {/* ── Source counts ─────────────────────────────────────────── */}
          {sourceCounts && (
            <div className="rounded border border-amber-500/20 bg-black/20 p-3 space-y-2">
              <p className="text-[10px] font-mono text-amber-300 uppercase">Firestore query source analysis</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "By stored month field", value: sourceCounts.byMonthField, warn: sourceCounts.byMonthField < 151 },
                  { label: "By ISO date range", value: sourceCounts.byDateRange, warn: false },
                  { label: "Combined (union)", value: sourceCounts.combined, warn: sourceCounts.combined < 151 },
                  { label: "Only in date range (wrong month)", value: sourceCounts.onlyInDateRange, warn: sourceCounts.onlyInDateRange > 0 },
                ].map(({ label, value, warn }) => (
                  <div key={label} className={`rounded p-2 ${warn ? "bg-red-900/30 border border-red-500/30" : "bg-black/20"}`}>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase leading-tight">{label}</p>
                    <p className={`font-mono text-sm font-bold ${warn ? "text-red-300" : ""}`}>{value}</p>
                  </div>
                ))}
              </div>
              {sourceCounts.onlyInDateRange > 0 && (
                <p className="text-[11px] font-mono text-red-300">
                  ⚠ {sourceCounts.onlyInDateRange} row(s) have an April date but wrong stored month field — click "Repair DB Rows" to fix.
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase">By status</p>
                  {Object.entries(sourceCounts.byStatus).sort().map(([s, n]) => (
                    <p key={s} className={`font-mono text-xs ${s === "skip" || s === "undefined" ? "text-red-300" : "text-muted-foreground"}`}>
                      {s}: {n}
                    </p>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase">By stored type</p>
                  {Object.entries(sourceCounts.byType).sort().map(([t, n]) => (
                    <p key={t} className="font-mono text-xs text-muted-foreground">{t}: {n}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Engine pipeline counts ─────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Rows received by engine", value: diag.rawCount, warn: diag.rawCount < 151 },
              { label: "Active (cleared/pending/review)", value: diag.activeCount },
              { label: "Final rows (after dedupe)", value: diag.finalCount },
              { label: "Dropped as duplicates", value: diag.excludedCount, warn: diag.excludedCount > 0 },
              { label: "Income rows (engine)", value: diag.incomeCount, warn: diag.incomeCount < 32 },
              { label: "Expense rows (engine)", value: diag.expenseCount, warn: diag.expenseCount < 119 },
              { label: "Raw income (stored)", value: `$${diag.rawIncome.toFixed(2)}` },
              { label: "Final income (engine)", value: `$${diag.finalIncome.toFixed(2)}`, warn: diag.finalIncome < 4000 },
              { label: "Raw spending (stored)", value: `$${diag.rawSpending.toFixed(2)}` },
              { label: "Final spending (engine)", value: `$${diag.finalSpending.toFixed(2)}` },
              { label: "Type reclassified by engine", value: diag.reclassifiedTypeCount, warn: diag.reclassifiedTypeCount > 10 },
              { label: "Category reclassified", value: diag.reclassifiedCategoryCount },
            ].map(({ label, value, warn }) => (
              <div key={label} className={`rounded p-2 ${warn ? "bg-red-900/20 border border-red-500/20" : "bg-black/20"}`}>
                <p className="text-[10px] font-mono text-muted-foreground uppercase leading-tight">{label}</p>
                <p className={`font-mono text-sm font-bold ${warn ? "text-red-300" : ""}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* ── Status + type breakdown from engine view ───────────────── */}
          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="bg-black/20 rounded p-2">
              <p className="text-[10px] text-amber-300 uppercase mb-1">Status breakdown (engine input)</p>
              {Object.entries(diag.statusBreakdown).sort().map(([s, n]) => (
                <div key={s} className="flex justify-between">
                  <span className={s === "skip" || s === "undefined" ? "text-red-300" : "text-muted-foreground"}>{s}</span>
                  <span>{n}</span>
                </div>
              ))}
            </div>
            <div className="bg-black/20 rounded p-2">
              <p className="text-[10px] text-amber-300 uppercase mb-1">Stored type breakdown</p>
              {Object.entries(diag.typeBreakdown).sort().map(([t, n]) => (
                <div key={t} className="flex justify-between">
                  <span className="text-muted-foreground">{t}</span>
                  <span>{n}</span>
                </div>
              ))}
            </div>
          </div>

          {diagExpanded && (
            <div className="space-y-3 pt-2 border-t border-border/30">
              {diag.topReclassifications.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono text-amber-300 uppercase mb-1">Type reclassifications (top {diag.topReclassifications.length})</p>
                  <div className="space-y-1">
                    {diag.topReclassifications.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs font-mono border-b border-border/20 pb-1">
                        <span className="truncate max-w-[200px]">{r.name}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">
                          ${r.amount.toFixed(2)} · {r.from} → <span className="text-amber-300">{r.to}</span> [{r.reason}]
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {diag.droppedRows.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono text-red-300 uppercase mb-1">Dropped as duplicates (top {diag.droppedRows.length})</p>
                  <div className="space-y-1">
                    {diag.droppedRows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs font-mono border-b border-border/20 pb-1">
                        <span className="truncate max-w-[200px]">{r.date} — {r.name}</span>
                        <span className="text-muted-foreground shrink-0 ml-2">${r.amount.toFixed(2)} · {r.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {diag.droppedRows.length === 0 && diag.topReclassifications.length === 0 && (
                <p className="text-xs font-mono text-muted-foreground">No reclassifications or dropped rows — data looks clean.</p>
              )}

              {/* ── Fixture comparison (April 2026 only) ─────────────────── */}
              {isAprilAudit && fixtureComparison && (
                <div className="space-y-3 pt-2 border-t border-cyan-500/20">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-mono text-cyan-300 uppercase">
                      Fixture comparison — verified 151-row April audit vs Firestore
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 h-6 px-2"
                      onClick={() => {
                        const lines: string[] = ["=== APRIL 2026 FIXTURE COMPARISON ===\n"];
                        lines.push(`MISSING FROM FIRESTORE (${fixtureComparison.missingFromFirestore.length} rows):`);
                        if (fixtureComparison.missingFromFirestore.length === 0) lines.push("  (none — all fixture rows found)");
                        fixtureComparison.missingFromFirestore.forEach(f =>
                          lines.push(`  ${f.date} | ${f.name} | $${f.amount.toFixed(2)} | ${f.expectedType} | ${f.expectedCategory}`)
                        );
                        lines.push(`\nEXTRA IN FIRESTORE (${fixtureComparison.extraInFirestore.length} rows):`);
                        if (fixtureComparison.extraInFirestore.length === 0) lines.push("  (none)");
                        fixtureComparison.extraInFirestore.forEach(tx =>
                          lines.push(`  ${normalizeLedgerDate(tx.date)} | ${tx.name} | $${Math.abs(tx.amount).toFixed(2)} | stored:${tx.type ?? "expense"}`)
                        );
                        lines.push(`\nWRONG STORED TYPE (${fixtureComparison.wrongStoredType.length} rows):`);
                        if (fixtureComparison.wrongStoredType.length === 0) lines.push("  (none)");
                        fixtureComparison.wrongStoredType.forEach(r =>
                          lines.push(`  ${r.fixture.date} | ${r.fixture.name} | $${r.fixture.amount.toFixed(2)} | stored:${r.storedType} expected:${r.expectedType}`)
                        );
                        lines.push(`\nENGINE WRONG TYPE (${fixtureComparison.wrongEngineType.length} rows — the $110.50 shift):`);
                        if (fixtureComparison.wrongEngineType.length === 0) lines.push("  (none)");
                        fixtureComparison.wrongEngineType.forEach(r =>
                          lines.push(`  ${r.fixture.date} | ${r.fixture.name} | $${r.fixture.amount.toFixed(2)} | engine:${r.engineType} expected:${r.expectedType} reason:${r.typeReason}`)
                        );
                        navigator.clipboard.writeText(lines.join("\n")).then(() => alert("Copied to clipboard!"));
                      }}
                    >
                      📋 Copy All
                    </Button>
                  </div>

                  {/* Missing rows */}
                  <div>
                    <p className="text-[10px] font-mono text-red-300 uppercase mb-1">
                      Missing from Firestore ({fixtureComparison.missingFromFirestore.length} rows — never imported or lost)
                    </p>
                    {fixtureComparison.missingFromFirestore.length === 0 ? (
                      <p className="text-xs font-mono text-emerald-400">✓ All fixture rows found in Firestore</p>
                    ) : (
                      <div className="space-y-0.5 max-h-48 overflow-y-auto">
                        {fixtureComparison.missingFromFirestore.map((f, i) => (
                          <div key={i} className="flex items-center justify-between text-xs font-mono border-b border-border/20 pb-0.5">
                            <span className="text-red-300 shrink-0 w-24">{f.date}</span>
                            <span className="truncate flex-1 mx-2">{f.name}</span>
                            <span className="shrink-0">${f.amount.toFixed(2)}</span>
                            <span className="shrink-0 ml-2 text-muted-foreground">[{f.expectedType}/{f.expectedCategory}]</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Extra rows */}
                  {fixtureComparison.extraInFirestore.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-orange-300 uppercase mb-1">
                        Extra in Firestore — not in fixture ({fixtureComparison.extraInFirestore.length} rows)
                      </p>
                      <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        {fixtureComparison.extraInFirestore.map((tx) => (
                          <div key={tx.id} className="flex items-center justify-between text-xs font-mono border-b border-border/20 pb-0.5">
                            <span className="text-orange-300 shrink-0 w-24">{normalizeLedgerDate(tx.date)}</span>
                            <span className="truncate flex-1 mx-2">{tx.name}</span>
                            <span className="shrink-0">${Math.abs(tx.amount).toFixed(2)}</span>
                            <span className="shrink-0 ml-2 text-muted-foreground">[{tx.type ?? "expense"}]</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Wrong stored type */}
                  {fixtureComparison.wrongStoredType.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-yellow-300 uppercase mb-1">
                        Wrong stored type ({fixtureComparison.wrongStoredType.length} rows)
                      </p>
                      <div className="space-y-0.5">
                        {fixtureComparison.wrongStoredType.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-xs font-mono border-b border-border/20 pb-0.5">
                            <span className="truncate max-w-[180px]">{r.fixture.date} — {r.fixture.name}</span>
                            <span className="text-yellow-300 shrink-0 ml-2">
                              stored {r.storedType} → should be {r.expectedType}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Wrong engine type */}
                  {fixtureComparison.wrongEngineType.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-pink-300 uppercase mb-1">
                        Engine reclassifies to wrong type ({fixtureComparison.wrongEngineType.length} rows — these create the $110.50 shift)
                      </p>
                      <div className="space-y-0.5">
                        {fixtureComparison.wrongEngineType.map((r, i) => (
                          <div key={i} className="flex items-center justify-between text-xs font-mono border-b border-border/20 pb-0.5">
                            <span className="truncate max-w-[180px]">{r.fixture.date} — {r.fixture.name} ${r.fixture.amount.toFixed(2)}</span>
                            <span className="text-pink-300 shrink-0 ml-2">
                              engine→{r.engineType} expected {r.expectedType} [{r.typeReason}]
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Income Row Diagnostic — every stored-income row, with engine reason ──── */}
          {diagExpanded && incomeDiagnostic.length > 0 && (
            <div className="mt-6 border-t border-emerald-500/30 pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-mono text-xs uppercase tracking-wider text-emerald-300 font-semibold">
                  Stored Income Rows ({incomeDiagnostic.length}) — engine lineage
                </h4>
                <Button
                  variant="ghost"
                  size="sm"
                  className="font-mono text-[10px] h-6 px-2"
                  onClick={async () => {
                    const lines: string[] = [];
                    lines.push(`=== STORED INCOME ROWS DIAGNOSTIC — ${monthKey} ===`);
                    lines.push(`Total stored income rows: ${incomeDiagnostic.length}`);
                    lines.push(`Engine kept as income:    ${incomeDiagnostic.filter((r) => r.included).length}`);
                    lines.push(`Demoted to expense:       ${incomeDiagnostic.filter((r) => r.typeChange === "demoted_to_expense").length}`);
                    lines.push(`Filtered out (status/dup):${incomeDiagnostic.filter((r) => r.typeChange === "filtered_out").length}`);
                    lines.push(`Stored income $ total:    $${incomeDiagnostic.reduce((s, r) => s + r.amount, 0).toFixed(2)}`);
                    lines.push(`Engine income $ total:    $${incomeDiagnostic.filter((r) => r.included).reduce((s, r) => s + r.amount, 0).toFixed(2)}`);
                    lines.push("");
                    lines.push("INCLUDED (kept as income):");
                    incomeDiagnostic.filter((r) => r.included).forEach((r) =>
                      lines.push(`  ${r.date} | ${r.name} | $${r.amount.toFixed(2)} | reason=${r.reason} | status=${r.status}`),
                    );
                    lines.push("");
                    lines.push("DEMOTED to expense (engine flipped income → expense):");
                    incomeDiagnostic
                      .filter((r) => r.typeChange === "demoted_to_expense")
                      .forEach((r) =>
                        lines.push(
                          `  ${r.date} | ${r.name} | $${r.amount.toFixed(2)} | reason=${r.reason} | category=${r.engineCategory}`,
                        ),
                      );
                    lines.push("");
                    lines.push("FILTERED OUT (not reached by engine):");
                    incomeDiagnostic
                      .filter((r) => r.typeChange === "filtered_out")
                      .forEach((r) =>
                        lines.push(
                          `  ${r.date} | ${r.name} | $${r.amount.toFixed(2)} | reason=${r.reason} | status=${r.status} | dup=${r.isDuplicate}`,
                        ),
                      );
                    await navigator.clipboard.writeText(lines.join("\n"));
                  }}
                >
                  📋 Copy
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3 font-mono text-[10px]">
                <div className="border border-emerald-500/30 rounded p-2 bg-emerald-500/5">
                  <div className="text-emerald-300 uppercase">Kept as income</div>
                  <div className="text-emerald-100 text-base font-bold">
                    {incomeDiagnostic.filter((r) => r.included).length}
                  </div>
                  <div className="text-emerald-200/80">
                    ${incomeDiagnostic.filter((r) => r.included).reduce((s, r) => s + r.amount, 0).toFixed(2)}
                  </div>
                </div>
                <div className="border border-amber-500/30 rounded p-2 bg-amber-500/5">
                  <div className="text-amber-300 uppercase">Demoted to expense</div>
                  <div className="text-amber-100 text-base font-bold">
                    {incomeDiagnostic.filter((r) => r.typeChange === "demoted_to_expense").length}
                  </div>
                  <div className="text-amber-200/80">
                    ${incomeDiagnostic.filter((r) => r.typeChange === "demoted_to_expense").reduce((s, r) => s + r.amount, 0).toFixed(2)}
                  </div>
                </div>
                <div className="border border-zinc-500/30 rounded p-2 bg-zinc-500/5">
                  <div className="text-zinc-300 uppercase">Filtered out</div>
                  <div className="text-zinc-100 text-base font-bold">
                    {incomeDiagnostic.filter((r) => r.typeChange === "filtered_out").length}
                  </div>
                  <div className="text-zinc-200/80">
                    ${incomeDiagnostic.filter((r) => r.typeChange === "filtered_out").reduce((s, r) => s + r.amount, 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="font-mono text-[10px] max-h-64 overflow-y-auto border border-border/40 rounded">
                <table className="w-full">
                  <thead className="bg-zinc-900/60 sticky top-0">
                    <tr className="text-zinc-300">
                      <th className="text-left p-1">Date</th>
                      <th className="text-left p-1">Name</th>
                      <th className="text-right p-1">Amount</th>
                      <th className="text-left p-1">Stored→Engine</th>
                      <th className="text-left p-1">Reason</th>
                      <th className="text-left p-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeDiagnostic.map((r) => {
                      const rowColor = r.included
                        ? "text-emerald-200"
                        : r.typeChange === "demoted_to_expense"
                          ? "text-amber-200"
                          : "text-zinc-400";
                      return (
                        <tr key={r.id} className={`${rowColor} border-b border-border/20`}>
                          <td className="p-1 whitespace-nowrap">{r.date}</td>
                          <td className="p-1 truncate max-w-[180px]">{r.name}</td>
                          <td className="p-1 text-right">${r.amount.toFixed(2)}</td>
                          <td className="p-1 whitespace-nowrap">{r.storedType}→{r.engineType}</td>
                          <td className="p-1">{r.reason}</td>
                          <td className="p-1">{r.status}{r.isDuplicate ? " (dup)" : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {diagExpanded && dashboardDiag.rows.length > 0 && (
            <div className="mt-6 border-t border-cyan-500/30 pt-4">
              <h4 className="font-mono text-xs uppercase tracking-wider text-cyan-300 font-semibold mb-2">
                Row-Level Inclusion Diagnostics ({dashboardDiag.rows.length} rows)
              </h4>
              <div className="font-mono text-[10px] max-h-72 overflow-y-auto border border-border/40 rounded">
                <table className="w-full">
                  <thead className="bg-zinc-900/60 sticky top-0">
                    <tr className="text-zinc-300">
                      <th className="text-left p-1">ID</th>
                      <th className="text-left p-1">Date</th>
                      <th className="text-left p-1">Posted</th>
                      <th className="text-left p-1">Merchant</th>
                      <th className="text-right p-1">Amount</th>
                      <th className="text-left p-1">Stored/Engine</th>
                      <th className="text-left p-1">Category</th>
                      <th className="text-left p-1">Status</th>
                      <th className="text-left p-1">Dup</th>
                      <th className="text-left p-1">Included</th>
                      <th className="text-left p-1">Exclusion</th>
                      <th className="text-left p-1">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardDiag.rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/20">
                        <td className="p-1">{r.id.slice(0, 8)}</td>
                        <td className="p-1">{r.date}</td>
                        <td className="p-1">{r.postedDate ?? "—"}</td>
                        <td className="p-1 truncate max-w-[180px]">{r.name}</td>
                        <td className="p-1 text-right">${r.amount.toFixed(2)}</td>
                        <td className="p-1">{r.storedType}→{r.engineType}</td>
                        <td className="p-1">{r.category}</td>
                        <td className="p-1">{r.status}</td>
                        <td className="p-1">{r.isDuplicate ? `${r.duplicateReason ?? "dup"} (${r.duplicateConfidence ?? "?"})` : "—"}</td>
                        <td className="p-1">{r.includedInDashboard ? "true" : "false"}</td>
                        <td className="p-1">{r.exclusionReason ?? "—"}</td>
                        <td className="p-1">{r.source ?? r.sourceFile ?? r.importBatch ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 space-y-2">
                <h4 className="font-mono text-xs uppercase tracking-wider text-cyan-300 font-semibold">
                  April Spending Audit ({spendingRows.length} expense rows)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] font-mono">
                  <div className="rounded bg-black/20 p-2">
                    <p className="text-muted-foreground uppercase">Raw spending total</p>
                    <p className="text-sm">${rawSpendingTotal.toFixed(2)}</p>
                  </div>
                  <div className="rounded bg-black/20 p-2">
                    <p className="text-muted-foreground uppercase">Included spending total</p>
                    <p className="text-sm text-red-300">${includedSpendingTotal.toFixed(2)}</p>
                  </div>
                  <div className="rounded bg-black/20 p-2">
                    <p className="text-muted-foreground uppercase">Excluded spending total</p>
                    <p className="text-sm text-emerald-300">${excludedSpendingTotal.toFixed(2)}</p>
                  </div>
                  <div className="rounded bg-black/20 p-2">
                    <p className="text-muted-foreground uppercase">Expected spending total</p>
                    <p className="text-sm">${APRIL_EXPECTED.spending.toFixed(2)}</p>
                  </div>
                  <div className="rounded bg-black/20 p-2">
                    <p className="text-muted-foreground uppercase">Difference</p>
                    <p className={`text-sm ${spendingDiffFromExpected > 0 ? "text-red-300" : "text-emerald-300"}`}>
                      {spendingDiffFromExpected >= 0 ? "+" : ""}${spendingDiffFromExpected.toFixed(2)}
                    </p>
                  </div>
                </div>

                {spendingFixtureDelta && (
                  <div className="grid sm:grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="rounded bg-black/20 p-2">
                      <p className="text-muted-foreground uppercase">Extra spending rows in Firestore</p>
                      <p>{spendingFixtureDelta.extraSpendingRows.length} rows · ${spendingFixtureDelta.extraTotal.toFixed(2)}</p>
                    </div>
                    <div className="rounded bg-black/20 p-2">
                      <p className="text-muted-foreground uppercase">Missing spending rows from fixture</p>
                      <p>{spendingFixtureDelta.missingSpendingRows.length} rows · ${spendingFixtureDelta.missingTotal.toFixed(2)}</p>
                    </div>
                    <div className="rounded bg-black/20 p-2">
                      <p className="text-muted-foreground uppercase">Net fixture delta (extra - missing)</p>
                      <p className={spendingFixtureDelta.netDelta > 0 ? "text-red-300" : "text-emerald-300"}>
                        ${spendingFixtureDelta.netDelta.toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}

                <div className="font-mono text-[10px] max-h-72 overflow-y-auto border border-border/40 rounded">
                  <table className="w-full">
                    <thead className="bg-zinc-900/60 sticky top-0">
                      <tr className="text-zinc-300">
                        <th className="text-left p-1">ID</th>
                        <th className="text-left p-1">Date</th>
                        <th className="text-left p-1">Posted</th>
                        <th className="text-left p-1">Merchant</th>
                        <th className="text-right p-1">Amount</th>
                        <th className="text-left p-1">Stored/Engine</th>
                        <th className="text-left p-1">Category</th>
                        <th className="text-left p-1">Status</th>
                        <th className="text-left p-1">Dup</th>
                        <th className="text-left p-1">Included</th>
                        <th className="text-left p-1">Source</th>
                        <th className="text-left p-1">Reason Included</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spendingRows
                        .slice()
                        .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
                        .map((r) => (
                          <tr key={`sp-${r.id}`} className="border-b border-border/20">
                            <td className="p-1">{r.id.slice(0, 8)}</td>
                            <td className="p-1">{r.date}</td>
                            <td className="p-1">{r.postedDate ?? "—"}</td>
                            <td className="p-1 truncate max-w-[180px]">{r.name}</td>
                            <td className="p-1 text-right">${r.amount.toFixed(2)}</td>
                            <td className="p-1">{r.storedType}→{r.engineType}</td>
                            <td className="p-1">{r.category}</td>
                            <td className="p-1">{r.status}</td>
                            <td className="p-1">{r.isDuplicate ? `${r.duplicateReason ?? "dup"} (${r.duplicateConfidence ?? "?"})` : "—"}</td>
                            <td className="p-1">{r.includedInDashboard ? "true" : "false"}</td>
                            <td className="p-1">{r.source ?? r.sourceFile ?? r.importBatch ?? "—"}</td>
                            <td className="p-1">{includedReasonForRow(r)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {spendingFixtureDelta && spendingFixtureDelta.overageCandidates.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-mono text-amber-300 uppercase">
                      Overage candidates (extra spending rows fitting ${Math.max(0, spendingDiffFromExpected).toFixed(2)})
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto border border-border/30 rounded p-2 bg-black/20">
                      {spendingFixtureDelta.overageCandidates.map((r) => (
                        <div key={`ovr-${r.id}`} className="flex items-center justify-between border-b border-border/20 pb-1">
                          <span className="truncate max-w-[75%]">{r.date} — {r.name} ({r.id.slice(0, 8)})</span>
                          <span className="text-red-300">${r.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                
              </div>
            </div>
          )}

          {/* ── Suspected Income Duplicates — manual review only, never auto-delete ── */}
          {diagExpanded && suspectedIncomeDuplicates.length > 0 && (
            <div className="mt-6 border-t border-orange-500/30 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-mono text-xs uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Suspected Income Duplicates ({suspectedIncomeDuplicates.length} group{suspectedIncomeDuplicates.length !== 1 ? "s" : ""})
                </h4>
                <span className="font-mono text-[10px] text-orange-200/70">
                  Same date + amount. Review manually — nothing is auto-deleted.
                </span>
              </div>

              <div className="space-y-3">
                {suspectedIncomeDuplicates.map((group) => {
                  const groupKey = `${group.date}|${group.amount.toFixed(2)}`;
                  const isKept = keptDuplicateGroups.has(groupKey);
                  const totalInflation = group.amount * (group.rows.length - 1);
                  return (
                    <div
                      key={groupKey}
                      className={`border rounded-lg p-3 font-mono text-[11px] ${
                        isKept
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : "border-orange-500/40 bg-orange-500/5"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-orange-200 font-semibold">
                            {group.date} — ${group.amount.toFixed(2)} × {group.rows.length} rows
                          </span>
                          <span className="ml-3 text-orange-200/70">
                            (inflates Money In by ${totalInflation.toFixed(2)} if all kept)
                          </span>
                        </div>
                        {isKept && (
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-0.5">
                              ✓ Marked legitimate
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="font-mono text-[10px] h-6 px-2 text-orange-300 hover:bg-orange-500/10"
                              title="Undo — flip this group back to review state so you can delete one"
                              onClick={() =>
                                setKeptDuplicateGroups((prev) => {
                                  const next = new Set(prev);
                                  next.delete(groupKey);
                                  return next;
                                })
                              }
                            >
                              ↶ Undo
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {group.rows.map((tx, idx) => {
                          const isFirst = idx === 0;
                          return (
                            <div
                              key={tx.id}
                              className="flex items-center justify-between gap-3 border border-border/30 rounded px-2 py-1.5 bg-card/30"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-zinc-200 truncate" title={tx.name}>
                                  {tx.name}
                                </div>
                                <div className="text-[9px] text-muted-foreground mt-0.5">
                                  id: {tx.id.slice(0, 8)} · status: {tx.status} · stored: {tx.type}
                                  {isFirst && <span className="ml-2 text-emerald-400">[KEEP — original]</span>}
                                </div>
                              </div>
                              <div className="text-emerald-400 font-bold whitespace-nowrap">
                                +${Math.abs(tx.amount).toFixed(2)}
                              </div>
                              {!isFirst && !isKept && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="font-mono text-[9px] h-7 border-red-500/40 text-red-300 hover:bg-red-500/10"
                                  disabled={deleteTxMutation.isPending}
                                  onClick={() => {
                                    deleteTxMutation.mutate(
                                      { id: tx.id, month: tx.month ?? monthKey },
                                      {
                                        onSuccess: () =>
                                          toast({
                                            title: "Duplicate income row deleted",
                                            description: `${tx.date} ${tx.name} ($${Math.abs(tx.amount).toFixed(2)})`,
                                          }),
                                        onError: (err: unknown) =>
                                          toast({
                                            variant: "destructive",
                                            title: "Delete failed",
                                            description: err instanceof Error ? err.message : "Unknown error",
                                          }),
                                      },
                                    );
                                  }}
                                >
                                  Delete this row
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {!isKept && (
                        <div className="flex justify-end mt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="font-mono text-[10px] h-7 text-emerald-300 hover:bg-emerald-500/10"
                            onClick={() =>
                              setKeptDuplicateGroups((prev) => {
                                const next = new Set(prev);
                                next.add(groupKey);
                                return next;
                              })
                            }
                          >
                            Keep all — these are legitimate repeated deposits
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="surface-tech">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Income Deposits Counted
            </CardTitle>
          </CardHeader>
          <CardContent>
            {incomeDeposits.length === 0 ? (
              <div className="text-sm text-muted-foreground font-mono">No posted income deposits for this month.</div>
            ) : (
              <div className="space-y-2">
                {incomeDeposits.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between font-mono text-xs border-b border-border/40 pb-1">
                    <span className="truncate max-w-[220px]">{tx.date} — {tx.name}</span>
                    <span className="text-emerald-400 font-semibold">+${Math.abs(tx.amount).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="surface-tech">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> Income by Source
            </CardTitle>
          </CardHeader>
          <CardContent>
            {incomeSources.length === 0 ? (
              <div className="text-sm text-muted-foreground font-mono">No income recorded this month.</div>
            ) : (
              <div className="space-y-3">
                {[...incomeSources].sort((a, b) => b[1] - a[1]).map(([source, amount]) => {
                  const pct = cashFlowMoneyIn > 0 ? (amount / cashFlowMoneyIn) * 100 : 0;
                  return (
                    <div key={source}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-mono uppercase tracking-wide ${INCOME_SOURCE_COLORS[source] ?? "text-muted-foreground"}`}>{source}</span>
                        <span className="text-sm font-bold font-mono">${amount.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="border-t border-border/50 pt-2 mt-3 flex justify-between">
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Total</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">${cashFlowMoneyIn.toFixed(2)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="surface-tech">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.entries(categoryTotals).filter(([, amount]) => amount > 0).length === 0 ? (
              <div className="text-sm text-muted-foreground font-mono">No expenses recorded this month.</div>
            ) : (
              <div className="space-y-3">
                {Object.entries(categoryTotals).filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]).map(([cat, amount]) => {
                  const pct = totalSpending > 0 ? (amount / totalSpending) * 100 : 0;
                  const isWaste = cat === "Waste";
                  const label = CATEGORY_DISPLAY[cat] ?? cat;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-mono uppercase ${isWaste ? "text-red-400" : "text-muted-foreground"}`}>{label}</span>
                        <span className="text-sm font-bold font-mono">${amount.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isWaste ? "bg-red-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {billsTotal > 0 && (
        <Card className="surface-tech">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Income vs Bills — {monthKey}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Earned income</p>
                <p className="text-xl font-bold font-mono text-emerald-400 mt-1">${earnedIncome.toFixed(2)}</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-1">Cash flow in ${cashFlowMoneyIn.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Bills Total</p>
                <p className="text-xl font-bold font-mono text-blue-400 mt-1">${billsTotal.toFixed(2)}</p>
                <p className="text-[10px] font-mono text-emerald-400 mt-1">${billsPaid.toFixed(2)} paid</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Safe to Spend</p>
                <p className={`text-xl font-bold font-mono mt-1 ${safeToSpend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {safeToSpend >= 0 ? "+" : ""}${safeToSpend.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Coverage</p>
                <p className={`text-xl font-bold font-mono mt-1 ${isCovered ? "text-emerald-400" : "text-red-400"}`}>
                  {billsCoverageRate !== null ? `${billsCoverageRate.toFixed(0)}%` : "—"}
                </p>
              </div>
            </div>
            <div className="mt-4 w-full bg-muted rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${isCovered ? "bg-emerald-500" : "bg-red-500"}`}
                style={{ width: `${billsCoverageRate !== null ? Math.min(billsCoverageRate, 100) : 0}%` }}
              />
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-2">
              {isCovered
                ? `Income covers all bills with $${safeToSpend.toFixed(2)} remaining for discretionary spending.`
                : `Income is $${Math.abs(safeToSpend).toFixed(2)} short of covering all bills this month.`}
            </p>
          </CardContent>
        </Card>
      )}

      {topWaste.length > 0 && (
        <Card className="surface-tech border-red-500/25">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono uppercase tracking-wider text-sm flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" /> Top Wasteful Spending — {monthKey}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {topWaste.map((tx, i) => (
                <div key={tx.id} className="flex items-center gap-3 px-6 py-3">
                  <span className="font-mono text-sm text-muted-foreground w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm truncate">{tx.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{tx.date}</p>
                  </div>
                  <span className="font-mono font-bold text-sm text-red-400">${tx.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="surface-tech">
        <CardHeader>
          <CardTitle className="font-mono uppercase tracking-wider text-sm">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTxs.length === 0 ? (
            <div className="text-sm text-muted-foreground font-mono">No transactions found.</div>
          ) : (
            <div className="space-y-3">
              {recentTxs.map((tx) => {
                const isIncome = tx.type === "income";
                return (
                  <div key={tx.id} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      {isIncome ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /> : <TrendingDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                      <div>
                        <p className="text-sm font-medium font-sans truncate w-[140px] sm:w-[220px]">{tx.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{tx.date}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold font-mono ${isIncome ? "text-emerald-400" : ""}`}>
                        {isIncome ? "+" : ""}${tx.amount.toFixed(2)}
                      </p>
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">
                        {isIncome ? (tx.incomeCategory ?? "Income") : tx.category}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
