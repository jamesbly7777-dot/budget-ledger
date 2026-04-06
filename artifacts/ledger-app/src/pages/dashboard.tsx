import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTransactions, useBills } from "@/hooks/use-finance";
import { computeCategoryTotals, computeIncomeTotals } from "@/lib/firestoreService";
import { Loader2, TrendingUp, TrendingDown, Activity, ShieldAlert, ShieldCheck, AlertTriangle, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getMonthKey } from "@/lib/rulesEngine";
import type { Bill } from "@/lib/types";

function isPaidInMonth(bill: Bill, month: string): boolean {
  if (bill.paidMonths) return bill.paidMonths.includes(month);
  return bill.isPaid;
}

const INCOME_SOURCE_COLORS: Record<string, string> = {
  Payroll: "text-blue-400",
  "Gig Work": "text-purple-400",
  "Cash Transfer": "text-cyan-400",
  "Side Business": "text-orange-400",
  "Other Income": "text-emerald-300",
};

export default function DashboardPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: transactions, isLoading: txLoading } = useTransactions(selectedMonth);
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

  // Bills: use selected month for totals/coverage, real current month for upcoming/due-date display
  const today = new Date();
  const todayDay = today.getDate();
  const realCurrentMonth = getMonthKey(today);

  const monthlyBills = (bills || []).filter((b) => b.isRecurring || b.month === selectedMonth);
  const billsTotal = monthlyBills.reduce((sum, b) => sum + b.amount, 0);
  const safeToSpend = totalIncome - billsTotal;
  const billsCoverageRate = totalIncome > 0 && billsTotal > 0 ? Math.min((totalIncome / billsTotal) * 100, 999) : null;
  const isCovered = totalIncome >= billsTotal && billsTotal > 0;

  // Upcoming bills: use real current month bills + real today's date for due-day math
  const currentMonthBills = (bills || []).filter((b) => b.isRecurring || b.month === realCurrentMonth);
  const unpaidThisMonth = currentMonthBills.filter((b) => !isPaidInMonth(b, realCurrentMonth));
  const upcomingBills = unpaidThisMonth
    .map((b) => ({ ...b, daysUntil: b.dueDay >= todayDay ? b.dueDay - todayDay : 32 - todayDay + b.dueDay }))
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-400">${totalIncome.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{income.length} source{income.length !== 1 ? "s" : ""} this month</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Spending</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-red-400">${totalSpending.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{expenses.length} transaction{expenses.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
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

        <Card className={`border-2 ${billsTotal === 0 ? "border-border bg-card" : isCovered ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
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
                return (
                  <div key={bill.id} className={`flex items-center gap-3 px-6 py-3 ${isOverdue ? "bg-red-500/5" : isDueToday ? "bg-yellow-500/5" : ""}`}>
                    <div className="w-14 text-center">
                      <span className={`font-mono text-lg font-bold ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : "text-muted-foreground"}`}>
                        {bill.dueDay}
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
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Income vs Bills — {selectedMonth}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Income</p>
                <p className="text-xl font-bold font-mono text-emerald-400 mt-1">${totalIncome.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Bills Total</p>
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
                ? `Income covers all bills with $${safeToSpend.toFixed(2)} remaining for discretionary spending.`
                : `Income is $${Math.abs(safeToSpend).toFixed(2)} short of covering all bills this month.`}
            </p>
          </CardContent>
        </Card>
      )}

      {topWaste.length > 0 && (
        <Card className="border-border border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono uppercase tracking-wider text-sm flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" /> Top Wasteful Spending — {selectedMonth}
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
