import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTransactions, useBills } from "@/hooks/use-finance";
import { computeCategoryTotals } from "@/lib/firestoreService";
import { format } from "date-fns";
import { Loader2, ArrowUpRight, ArrowDownRight, Activity, CreditCard, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
  const totalSpending = txs.reduce((sum, t) => sum + t.amount, 0);
  const categoryTotals = computeCategoryTotals(txs);

  // Month Bills vs Transactions
  const monthlyBills = (bills || []).filter(b => b.isRecurring || b.month === selectedMonth);
  const billsTotal = monthlyBills.reduce((sum, b) => sum + b.amount, 0);

  const recentTxs = [...txs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Spending</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">${totalSpending.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Bills Total</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-blue-400">${categoryTotals["Bills"].toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">Expected: ${billsTotal.toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Waste</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-destructive">${categoryTotals["Waste"].toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Fuel / Medical</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-orange-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-orange-400">${categoryTotals["Fuel"].toFixed(2)}</div>
            <p className="text-xs text-purple-400 mt-1 font-mono">Med: ${categoryTotals["Medical"].toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentTxs.length === 0 ? (
                <div className="text-sm text-muted-foreground font-mono">No transactions found.</div>
              ) : (
                recentTxs.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium font-sans truncate w-[150px] sm:w-[200px]">{tx.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{tx.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold font-mono">${tx.amount.toFixed(2)}</p>
                      <Badge variant="outline" className="text-[10px] uppercase font-mono">{tx.category}</Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Category Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(categoryTotals)
                .filter(([_, amount]) => amount > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, amount]) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-sm font-mono text-muted-foreground uppercase">{cat}</span>
                  <span className="text-sm font-bold font-mono">${amount.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
