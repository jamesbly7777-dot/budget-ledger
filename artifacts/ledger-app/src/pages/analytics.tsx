import { useState, useMemo } from "react";
import { useTransactions } from "@/hooks/use-finance";
import { computeCategoryTotals, computeIncomeTotals } from "@/lib/firestoreService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, TrendingUp, TrendingDown, Minus, Target } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import { TransactionCategory, Transaction } from "@/lib/types";

const CATEGORIES: TransactionCategory[] = [
  "Bills", "Fuel", "Necessary", "Medical", "Shopping",
  "Transfers", "Personal", "Waste", "Uncategorized",
];

const MONTH_COLORS = [
  "hsl(var(--primary))",
  "#f59e0b",
  "#3b82f6",
  "#a855f7",
  "#06b6d4",
  "#ec4899",
];

const DEFAULT_GOALS: Record<TransactionCategory, number> = {
  Bills: 0, Fuel: 0, Necessary: 0, Medical: 0, Shopping: 0,
  Transfers: 0, Personal: 0, Waste: 0, Uncategorized: 0,
};

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short" }) + " '" + year.slice(2);
}

export default function AnalyticsPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: allTxs, isLoading } = useTransactions();

  const [goals, setGoals] = useState<Record<TransactionCategory, number>>(() => {
    try {
      const s = localStorage.getItem("categoryGoals");
      return s ? { ...DEFAULT_GOALS, ...JSON.parse(s) } : DEFAULT_GOALS;
    } catch { return DEFAULT_GOALS; }
  });
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalsForm, setGoalsForm] = useState<Record<TransactionCategory, number>>(goals);

  const saveGoals = () => {
    setGoals(goalsForm);
    localStorage.setItem("categoryGoals", JSON.stringify(goalsForm));
    setGoalsOpen(false);
  };

  const monthlyData = useMemo(() => {
    if (!allTxs) return [];
    const byMonth: Record<string, Transaction[]> = {};
    for (const tx of allTxs) {
      if (!byMonth[tx.month]) byMonth[tx.month] = [];
      byMonth[tx.month].push(tx);
    }
    const sortedMonths = Object.keys(byMonth).sort().slice(-6);
    return sortedMonths.map((month) => {
      const txs = byMonth[month];
      const catTotals = computeCategoryTotals(txs);
      const incTotals = computeIncomeTotals(txs);
      const totalSpending = Object.values(catTotals).reduce((a, b) => a + b, 0);
      const totalIncome = Object.values(incTotals).reduce((a, b) => a + b, 0);
      return { month, label: formatMonthLabel(month), categories: catTotals, totalSpending, totalIncome };
    });
  }, [allTxs]);

  const currentMonthData = monthlyData.find((m) => m.month === selectedMonth);
  const currentIdx = monthlyData.findIndex((m) => m.month === selectedMonth);
  const prevMonthData = currentIdx > 0 ? monthlyData[currentIdx - 1] : null;

  const netFlowData = monthlyData.map((m) => ({
    name: m.label,
    Income: parseFloat(m.totalIncome.toFixed(2)),
    Spending: parseFloat(m.totalSpending.toFixed(2)),
    Net: parseFloat((m.totalIncome - m.totalSpending).toFixed(2)),
  }));

  const recentMonths = monthlyData.slice(-3);
  const comparisonData = CATEGORIES.map((cat) => {
    const entry: Record<string, any> = { category: cat.substring(0, 4) };
    recentMonths.forEach((m) => { entry[m.label] = parseFloat((m.categories[cat] || 0).toFixed(2)); });
    return entry;
  }).filter((d) => recentMonths.some((m) => (d[m.label] || 0) > 0));

  const wasteGoal = goals["Waste"];
  const wasteCurrent = currentMonthData?.categories["Waste"] || 0;
  const wastePrev = prevMonthData?.categories["Waste"] || 0;
  const wasteChange = wastePrev > 0 ? ((wasteCurrent - wastePrev) / wastePrev) * 100 : 0;
  const wasteImproving = wasteCurrent < wastePrev && wastePrev > 0;

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!allTxs || allTxs.length === 0 || monthlyData.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Analytics</h2>
        <div className="text-center py-24 text-muted-foreground font-mono text-sm">
          Import transactions to see trends and comparisons.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Analytics</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">Trends, comparisons and spending goals</p>
        </div>
        <Button variant="outline" onClick={() => { setGoalsForm(goals); setGoalsOpen(true); }} className="font-mono text-xs uppercase tracking-wider">
          <Target className="h-4 w-4 mr-2" /> Set Goals
        </Button>
      </div>

      {wasteCurrent > 0 && (
        <Card className={`border-2 ${wasteImproving ? "border-green-500/40 bg-green-500/5" : wastePrev > 0 ? "border-red-500/40 bg-red-500/5" : "border-border"}`}>
          <CardContent className="pt-5 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Waste Spending — {currentMonthData?.label ?? selectedMonth}</p>
                <p className="text-4xl font-bold font-mono mt-1">${wasteCurrent.toFixed(2)}</p>
                <div className="flex items-center gap-2 mt-1">
                  {wastePrev > 0 ? (
                    <>
                      {wasteImproving
                        ? <TrendingDown className="w-4 h-4 text-green-400" />
                        : <TrendingUp className="w-4 h-4 text-red-400" />}
                      <span className={`font-mono text-sm ${wasteImproving ? "text-green-400" : "text-red-400"}`}>
                        {wasteImproving ? "↓" : "↑"}{Math.abs(wasteChange).toFixed(0)}% vs {prevMonthData?.label}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-sm text-muted-foreground">No prior month data</span>
                  )}
                </div>
              </div>
              {wasteGoal > 0 && (
                <div className="sm:text-right">
                  <p className="font-mono text-xs text-muted-foreground uppercase">Goal: ${wasteGoal}</p>
                  <p className={`font-mono text-sm font-bold mt-1 ${wasteCurrent <= wasteGoal ? "text-green-400" : "text-red-400"}`}>
                    {wasteCurrent <= wasteGoal ? `$${(wasteGoal - wasteCurrent).toFixed(2)} under budget` : `$${(wasteCurrent - wasteGoal).toFixed(2)} over budget`}
                  </p>
                  <div className="w-40 bg-muted rounded-full h-2 mt-2 sm:ml-auto">
                    <div
                      className={`h-2 rounded-full transition-all ${wasteCurrent <= wasteGoal ? "bg-green-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min((wasteCurrent / wasteGoal) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Net Cash Flow — Last {netFlowData.length} Months</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={netFlowData} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#888", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#111", border: "1px solid #333", borderRadius: "4px", fontFamily: "monospace", fontSize: "11px" }}
                  formatter={(val: number, name: string) => [`$${val.toFixed(2)}`, name]}
                />
                <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: "10px", textTransform: "uppercase" }} />
                <Line type="monotone" dataKey="Income" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))", strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Spending" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: "#ef4444", strokeWidth: 0 }} />
                <Line type="monotone" dataKey="Net" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3, fill: "#f59e0b", strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {recentMonths.length >= 2 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Category Comparison — Last {recentMonths.length} Months
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="category" tick={{ fill: "#888", fontSize: 9, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#888", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111", border: "1px solid #333", borderRadius: "4px", fontFamily: "monospace", fontSize: "11px" }}
                    formatter={(val: number, name: string) => [`$${val.toFixed(2)}`, name]}
                  />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: "10px", textTransform: "uppercase" }} />
                  {recentMonths.map((m, i) => (
                    <Bar key={m.label} dataKey={m.label} fill={MONTH_COLORS[i]} radius={[3, 3, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Category Trends — {currentMonthData?.label ?? selectedMonth}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {CATEGORIES.filter((cat) => (currentMonthData?.categories[cat] || 0) > 0 || goals[cat] > 0).map((cat) => {
              const current = currentMonthData?.categories[cat] || 0;
              const previous = prevMonthData?.categories[cat] || 0;
              const goal = goals[cat];
              const pctChange = previous > 0 ? ((current - previous) / previous) * 100 : null;
              const improved = previous > 0 && current < previous;
              const worsened = previous > 0 && current > previous;

              return (
                <div key={cat} className="flex items-center gap-3 px-6 py-3">
                  <div className="w-28 font-mono text-sm">{cat}</div>
                  <div className="flex-1">
                    {goal > 0 && (
                      <div className="w-full bg-muted rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full ${current <= goal ? "bg-green-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min((current / goal) * 100, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="font-mono font-bold text-sm w-20 text-right">${current.toFixed(2)}</div>
                  <div className="w-28 text-right">
                    {pctChange !== null ? (
                      <div className="flex items-center justify-end gap-1">
                        {improved && <TrendingDown className="w-3.5 h-3.5 text-green-400" />}
                        {worsened && <TrendingUp className="w-3.5 h-3.5 text-red-400" />}
                        {!improved && !worsened && <Minus className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className={`font-mono text-xs ${improved ? "text-green-400" : worsened ? "text-red-400" : "text-muted-foreground"}`}>
                          {improved ? "↓" : worsened ? "↑" : "="}{Math.abs(pctChange).toFixed(0)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">—</span>
                    )}
                  </div>
                  <div className="w-20 text-right font-mono text-xs text-muted-foreground">
                    {goal > 0 ? `/$${goal}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
          {(!currentMonthData || Object.values(currentMonthData.categories).every(v => v === 0)) && (
            <div className="text-center py-8 text-muted-foreground font-mono text-sm">No data for {selectedMonth}.</div>
          )}
        </CardContent>
      </Card>

      <Dialog open={goalsOpen} onOpenChange={setGoalsOpen}>
        <DialogContent className="sm:max-w-[400px] bg-card border-border max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Spending Goals</DialogTitle>
            <p className="text-xs text-muted-foreground font-mono">Set a monthly spending limit per category. Leave at 0 to skip.</p>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center gap-3">
                <Label className="font-mono text-xs w-28 text-muted-foreground uppercase">{cat}</Label>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-mono">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    placeholder="0"
                    value={goalsForm[cat] || ""}
                    onChange={(e) => setGoalsForm({ ...goalsForm, [cat]: parseFloat(e.target.value) || 0 })}
                    className="font-mono bg-input border-border pl-7 h-8 text-sm"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setGoalsOpen(false)} className="font-mono text-xs uppercase h-8">Cancel</Button>
            <Button onClick={saveGoals} className="font-mono text-xs uppercase h-8">Save Goals</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
