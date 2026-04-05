import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTransactions, useBills } from "@/hooks/use-finance";
import { computeCategoryTotals, computeIncomeTotals } from "@/lib/firestoreService";
import { Loader2, ArrowUpRight, Activity, CreditCard, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const txs = transactions || [];
  const expenses = txs.filter((t) => !t.type || t.type === "expense");
  const income = txs.filter((t) => t.type === "income");

  const totalSpending = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0);
  const net = totalIncome - totalSpending;

  const categoryTotals = computeCategoryTotals(txs);
  const incomeTotals = computeIncomeTotals(txs);
  const incomeSources = Object.entries(incomeTotals).filter(([, amount]) => amount > 0);

  const monthlyBills = (bills || []).filter((b) => b.isRecurring || b.month === selectedMonth);
  const billsTotal = monthlyBills.reduce((sum, b) => sum + b.amount, 0);

  const recentTxs = [...txs]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
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
            <p className="text-xs text-muted-foreground mt-1 font-mono">{income.length} source{income.length !== 1 ? "s" : ""}</p>
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

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Bills / Waste</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-blue-400">${categoryTotals["Bills"].toFixed(2)}</div>
            <p className="text-xs text-destructive mt-1 font-mono">Waste: ${categoryTotals["Waste"].toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

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
                {incomeSources
                  .sort((a, b) => b[1] - a[1])
                  .map(([source, amount]) => {
                    const pct = totalIncome > 0 ? (amount / totalIncome) * 100 : 0;
                    return (
                      <div key={source}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm font-mono uppercase tracking-wide ${INCOME_SOURCE_COLORS[source] ?? "text-muted-foreground"}`}>
                            {source}
                          </span>
                          <span className="text-sm font-bold font-mono">${amount.toFixed(2)}</span>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
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
            <div className="space-y-3">
              {Object.entries(categoryTotals)
                .filter(([, amount]) => amount > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amount]) => {
                  const pct = totalSpending > 0 ? (amount / totalSpending) * 100 : 0;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-mono text-muted-foreground uppercase">{cat}</span>
                        <span className="text-sm font-bold font-mono">${amount.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-mono uppercase tracking-wider text-sm">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentTxs.length === 0 ? (
              <div className="text-sm text-muted-foreground font-mono">No transactions found.</div>
            ) : (
              recentTxs.map((tx) => {
                const isIncome = tx.type === "income";
                return (
                  <div key={tx.id} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      {isIncome ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div>
                        <p className="text-sm font-medium font-sans truncate w-[140px] sm:w-[200px]">{tx.name}</p>
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
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
