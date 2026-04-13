import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTransactions, useBills } from "@/hooks/use-finance";
import { computeCategoryTotals, computeIncomeTotals } from "@/lib/firestoreService";
import { Loader2, TrendingUp, TrendingDown, Activity, ShieldAlert, ShieldCheck, AlertTriangle, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getMonthKey } from "@/lib/rulesEngine";
import { isEffectivelyPaidInMonth } from "@/lib/billStatus";
import { NeuralBrainHero } from "@/components/ui/NeuralBrainHero";

function fmtDate(raw: string): string {
  if (!raw) return raw;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const d = new Date(parseInt(mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return raw;
}

const INCOME_SOURCE_COLORS: Record<string, string> = {
  Payroll: "text-blue-400",
  "Gig Work": "text-purple-400",
  "Cash Transfer": "text-cyan-400",
  "Side Business": "text-orange-400",
  "Other Income": "text-emerald-300",
};

// Bills that apply to a given month — same logic as Bill Manager:
// recurring bills show every month; month-specific bills only show for their month (or bills with no month assigned).
function billsForMonth(allBills: any[], monthKey: string): any[] {
  return allBills.filter((b) => b.isRecurring || !b.month || b.month === monthKey);
}


export default function DashboardPage({ selectedMonth }: { selectedMonth: string }) {
  const today = new Date();
  const todayDay = today.getDate();

  // Single source of truth for which month this Overview shows.
  // selectedMonth may be "" briefly on first render — fall back to today.
  const monthKey = selectedMonth || getMonthKey(today);

  // ONE transaction stream for this month — used for both stats AND paid/unpaid checks.
  const { data: transactions, isLoading: txLoading } = useTransactions(monthKey);
  const { data: bills, isLoading: billsLoading } = useBills();

  if (txLoading || billsLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const txs = transactions || [];
  const expenses = txs.filter((t) => !t.type || t.type === "expense");
  const income = txs.filter((t) => t.type === "income");

  const totalSpending = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const totalIncome = income.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const net = totalIncome - totalSpending;

  const categoryTotals = computeCategoryTotals(txs);
  const incomeTotals = computeIncomeTotals(txs);
  const incomeSources = Object.entries(incomeTotals).filter(([, amount]) => amount > 0);

  // Only bills that apply to monthKey — same set as Bill Manager shows for this month.
  const monthBills = billsForMonth(bills ?? [], monthKey);
  const billsTotal = monthBills.reduce((sum, b) => sum + b.amount, 0);
  const safeToSpend = totalIncome - billsTotal;
  const billsCoverageRate = totalIncome > 0 && billsTotal > 0 ? Math.min((totalIncome / billsTotal) * 100, 100) : null;
  const isCovered = totalIncome >= billsTotal && billsTotal > 0;

  // Is the selected month the current calendar month?
  const isCurrentMonth = monthKey === getMonthKey(today);

  // Upcoming / unpaid bills — only meaningful for the current month.
  // Past months can't have "upcoming" bills — everything is either paid or was missed.
  const unpaidThisMonth = isCurrentMonth
    ? monthBills.filter((b) => !isEffectivelyPaidInMonth(b, monthKey, txs))
    : [];
  const upcomingBills = unpaidThisMonth
    .map((b) => ({ ...b, daysUntil: b.dueDay >= todayDay ? b.dueDay - todayDay : -(todayDay - b.dueDay) }))
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 6);
  const overdueBills = unpaidThisMonth.filter((b) => b.dueDay < todayDay);

  const topWaste = expenses
    .filter((t) => t.category === "Waste")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const recentTxs = [...txs]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <NeuralBrainHero income={totalIncome} spending={totalSpending} net={net} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card style={{ borderColor: "rgba(52,211,153,0.35)", boxShadow: "0 0 0 1px rgba(52,211,153,0.08), inset 0 1px 0 rgba(52,211,153,0.15), 0 0 32px rgba(52,211,153,0.10), 0 4px 24px rgba(0,0,0,0.4)" }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Total Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-emerald-400" style={{ textShadow: "0 0 20px rgba(52,211,153,0.5)" }}>${totalIncome.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1.5 font-mono uppercase tracking-wider">{income.length} source{income.length !== 1 ? "s" : ""} this month</p>
          </CardContent>
        </Card>

        <Card style={{ borderColor: "rgba(239,68,68,0.35)", boxShadow: "0 0 0 1px rgba(239,68,68,0.08), inset 0 1px 0 rgba(239,68,68,0.15), 0 0 32px rgba(239,68,68,0.10), 0 4px 24px rgba(0,0,0,0.4)" }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Total Spending</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-red-400" style={{ textShadow: "0 0 20px rgba(239,68,68,0.5)" }}>${totalSpending.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1.5 font-mono uppercase tracking-wider">{expenses.length} transaction{expenses.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>

        <Card style={{ borderColor: net >= 0 ? "rgba(52,211,153,0.35)" : "rgba(239,68,68,0.35)", boxShadow: net >= 0 ? "0 0 0 1px rgba(52,211,153,0.08), inset 0 1px 0 rgba(52,211,153,0.15), 0 0 32px rgba(52,211,153,0.10), 0 4px 24px rgba(0,0,0,0.4)" : "0 0 0 1px rgba(239,68,68,0.08), inset 0 1px 0 rgba(239,68,68,0.15), 0 0 32px rgba(239,68,68,0.10), 0 4px 24px rgba(0,0,0,0.4)" }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Net Cash Flow</CardTitle>
            <Activity className={`h-4 w-4 ${net >= 0 ? "text-emerald-400" : "text-destructive"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold font-mono ${net >= 0 ? "text-emerald-400" : "text-destructive"}`} style={{ textShadow: net >= 0 ? "0 0 20px rgba(52,211,153,0.5)" : "0 0 20px rgba(239,68,68,0.5)" }}>
              {net >= 0 ? "+" : ""}${net.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 font-mono uppercase tracking-wider">{net >= 0 ? "Surplus" : "Deficit"} this month</p>
          </CardContent>
        </Card>

        <Card style={{ borderColor: billsTotal === 0 ? "rgba(56,155,255,0.18)" : isCovered ? "rgba(52,211,153,0.35)" : "rgba(239,68,68,0.35)", boxShadow: billsTotal === 0 ? "0 0 0 1px rgba(56,155,255,0.06), inset 0 1px 0 rgba(56,155,255,0.10), 0 4px 24px rgba(0,0,0,0.4)" : isCovered ? "0 0 0 1px rgba(52,211,153,0.08), inset 0 1px 0 rgba(52,211,153,0.15), 0 0 32px rgba(52,211,153,0.10), 0 4px 24px rgba(0,0,0,0.4)" : "0 0 0 1px rgba(239,68,68,0.08), inset 0 1px 0 rgba(239,68,68,0.15), 0 0 32px rgba(239,68,68,0.10), 0 4px 24px rgba(0,0,0,0.4)" }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Bill Coverage</CardTitle>
            {billsTotal === 0 ? <ShieldAlert className="h-4 w-4 text-muted-foreground" /> : isCovered ? <ShieldCheck className="h-4 w-4 text-green-400" /> : <ShieldAlert className="h-4 w-4 text-red-400" />}
          </CardHeader>
          <CardContent>
            {billsTotal === 0 ? (
              <>
                <div className="text-3xl font-bold font-mono text-muted-foreground">—</div>
                <p className="text-xs text-muted-foreground mt-1.5 font-mono uppercase tracking-wider">No bills tracked</p>
              </>
            ) : (
              <>
                <div className={`text-3xl font-bold font-mono ${isCovered ? "text-green-400" : "text-red-400"}`} style={{ textShadow: isCovered ? "0 0 20px rgba(52,211,153,0.5)" : "0 0 20px rgba(239,68,68,0.5)" }}>
                  {billsCoverageRate !== null ? `${billsCoverageRate.toFixed(0)}%` : "—"}
                </div>
                <p className={`text-xs mt-1.5 font-mono uppercase tracking-wider ${safeToSpend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {safeToSpend >= 0 ? `+$${safeToSpend.toFixed(2)} after bills` : `-$${Math.abs(safeToSpend).toFixed(2)} short`}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {upcomingBills.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono uppercase tracking-wider text-sm flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" /> Upcoming Bills
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
                const [selYear, selMonth] = monthKey.split("-").map(Number);
                const dueDateObj = new Date(selYear, selMonth - 1, bill.dueDay);
                const formattedDate = dueDateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                return (
                  <div key={bill.id} className={`flex items-center gap-3 px-6 py-3 ${isOverdue ? "bg-red-500/5" : isDueToday ? "bg-yellow-500/5" : ""}`}>
                    <div className="w-16 text-center">
                      <span className={`font-mono text-sm font-bold ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : "text-emerald-400"}`}>
                        {formattedDate}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm truncate" title={bill.name}>{bill.name}</p>
                      <p className={`text-xs font-mono ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : isDueSoon ? "text-orange-400" : "text-muted-foreground"}`}>
                        {isOverdue ? `${todayDay - bill.dueDay}d overdue` : isDueToday ? "Due today" : `Due in ${bill.daysUntil}d`}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-sm">${bill.amount.toFixed(2)}</span>
                    {(isOverdue || isDueToday) && (
                      <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${isOverdue ? "badge-due" : "badge-pending"}`}>
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

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border">
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
                {incomeSources.sort((a, b) => b[1] - a[1]).map(([source, amount]) => {
                  const pct = totalIncome > 0 ? (amount / totalIncome) * 100 : 0;
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
                  <span className="text-sm font-bold font-mono text-emerald-400">${totalIncome.toFixed(2)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
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
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-mono uppercase ${isWaste ? "text-red-400" : "text-muted-foreground"}`}>{cat}</span>
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
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Income vs Bills — {monthKey}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Income</p>
                <p className="text-xl font-bold font-mono text-emerald-400 mt-1">${totalIncome.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Bills ({monthBills.length})</p>
                <p className="text-xl font-bold font-mono text-blue-400 mt-1">${billsTotal.toFixed(2)}</p>
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
                ? `Income covers all ${monthBills.length} bills with $${safeToSpend.toFixed(2)} left for discretionary spending.`
                : `Income is $${Math.abs(safeToSpend).toFixed(2)} short of covering all bills this month.`}
            </p>
          </CardContent>
        </Card>
      )}

      {topWaste.length > 0 && (
        <Card className="border-border border-red-500/20">
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
                    <p className="text-xs font-mono text-muted-foreground">{fmtDate(tx.date)}</p>
                  </div>
                  <span className="font-mono font-bold text-sm text-red-400">${tx.amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border">
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
                        <p className="text-xs text-muted-foreground font-mono">{fmtDate(tx.date)}</p>
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
