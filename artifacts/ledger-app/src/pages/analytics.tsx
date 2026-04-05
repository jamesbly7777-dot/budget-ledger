import { useTransactions, useMonths } from "@/hooks/use-finance";
import { computeCategoryTotals } from "@/lib/firestoreService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

export default function AnalyticsPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: transactions, isLoading: txLoading } = useTransactions(selectedMonth);
  const { data: monthsData, isLoading: monthsLoading } = useMonths();

  if (txLoading || monthsLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const txs = transactions || [];
  const totals = computeCategoryTotals(txs);
  
  const barData = Object.entries(totals)
    .filter(([_, val]) => val > 0)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Monthly trends (last 6 months)
  const trendsData = [...(monthsData || [])]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6)
    .map(m => ({
      name: m.label.split(' ')[0].substring(0,3), // short month name
      total: m.totalSpending
    }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Analytics</h2>
        <p className="text-muted-foreground font-mono text-sm mt-1">Data visualization and trends</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Category Breakdown ({selectedMonth})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip 
                      cursor={{fill: '#222'}} 
                      contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px' }}
                      formatter={(val: number) => [`$${val.toFixed(2)}`, 'Total']}
                    />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">No data</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm">Spending Trends (6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {trendsData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#888', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px' }}
                      formatter={(val: number) => [`$${val.toFixed(2)}`, 'Total']}
                    />
                    <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm">No data</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
