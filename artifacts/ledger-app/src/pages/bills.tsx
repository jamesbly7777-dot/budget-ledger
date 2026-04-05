import { useState, useEffect, useMemo } from "react";
import { useBills, useAddBill, useUpdateBill, useDeleteBill, useTransactions } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Edit2, Trash2, CheckCircle2, Circle, ScanSearch, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { TransactionCategory, Transaction } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

interface SuggestedBill {
  key: string;
  name: string;
  amount: number;
  dueDay: number;
  category: TransactionCategory;
  monthCount: number;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[*#@]/g, "")
    .replace(/\d{4,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectRecurringBills(transactions: Transaction[]): SuggestedBill[] {
  const expenses = transactions.filter((t) => !t.type || t.type === "expense");
  const groups: Record<string, Transaction[]> = {};
  for (const tx of expenses) {
    if (tx.amount < 10) continue;
    if (tx.category === "Transfers") continue;
    const key = normalizeName(tx.name);
    if (key.length < 3) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  }

  const suggestions: SuggestedBill[] = [];
  for (const [key, txs] of Object.entries(groups)) {
    const uniqueMonths = new Set(txs.map((t) => t.month));
    if (uniqueMonths.size < 2) continue;

    const days = txs.map((t) => {
      const parts = t.date.split("/");
      return parseInt(parts[1] ?? "1", 10);
    }).filter((d) => d >= 1 && d <= 31);
    if (days.length === 0) continue;

    const avgDay = days.reduce((a, b) => a + b, 0) / days.length;
    const dayStdDev = Math.sqrt(days.reduce((sum, d) => sum + (d - avgDay) ** 2, 0) / days.length);
    if (dayStdDev > 6) continue;

    const amounts = txs.map((t) => t.amount);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (avgAmount < 10) continue;
    const amountStdDev = Math.sqrt(amounts.reduce((sum, a) => sum + (a - avgAmount) ** 2, 0) / amounts.length);
    if (amountStdDev / avgAmount > 0.3) continue;

    const nameCounts: Record<string, number> = {};
    txs.forEach((t) => { nameCounts[t.name] = (nameCounts[t.name] ?? 0) + 1; });
    const bestName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1])[0][0];

    const catCounts: Record<string, number> = {};
    txs.forEach((t) => { catCounts[t.category] = (catCounts[t.category] ?? 0) + 1; });
    const bestCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0] as TransactionCategory;

    suggestions.push({
      key,
      name: bestName,
      amount: Math.round(avgAmount * 100) / 100,
      dueDay: Math.round(avgDay),
      category: bestCat,
      monthCount: uniqueMonths.size,
    });
  }

  return suggestions.sort((a, b) => a.dueDay - b.dueDay);
}

const CATEGORIES: TransactionCategory[] = [
  "Bills", "Fuel", "Necessary", "Medical", "Shopping",
  "Transfers", "Personal", "Waste", "Uncategorized",
];

const BLANK_FORM = { name: "", amount: "", dueDay: "1", category: "Bills" as TransactionCategory, isRecurring: true };

export default function BillsPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: bills, isLoading: billsLoading } = useBills();
  const { data: allTxs, isLoading: txLoading } = useTransactions();
  const addBill = useAddBill();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();
  const { toast } = useToast();

  const [paycheckDays, setPaycheckDays] = useState<[number, number]>(() => {
    try { const s = localStorage.getItem("paycheckDays"); return s ? JSON.parse(s) : [1, 15]; }
    catch { return [1, 15]; }
  });
  const [paycheckEdit, setPaycheckEdit] = useState(false);
  const [pcInput, setPcInput] = useState<[string, string]>([String(paycheckDays[0]), String(paycheckDays[1])]);

  const [detectOpen, setDetectOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedBill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addingAll, setAddingAll] = useState(false);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(BLANK_FORM);

  useEffect(() => {
    localStorage.setItem("paycheckDays", JSON.stringify(paycheckDays));
  }, [paycheckDays]);

  const monthlyBills = useMemo(
    () => (bills || []).filter((b) => b.isRecurring || b.month === selectedMonth).sort((a, b) => a.dueDay - b.dueDay),
    [bills, selectedMonth]
  );

  const [pc1, pc2] = paycheckDays;
  const window1Bills = monthlyBills.filter((b) => b.dueDay >= pc1 && b.dueDay < pc2);
  const window2Bills = monthlyBills.filter((b) => b.dueDay >= pc2 || b.dueDay < pc1);
  const totalAmount = monthlyBills.reduce((s, b) => s + b.amount, 0);
  const paidAmount = monthlyBills.filter((b) => b.isPaid).reduce((s, b) => s + b.amount, 0);
  const remaining = totalAmount - paidAmount;

  const handleScan = () => {
    if (!allTxs || allTxs.length === 0) {
      toast({ description: "Import transactions first to scan for recurring bills." });
      return;
    }
    const existingKeys = new Set((bills || []).map((b) => normalizeName(b.name)));
    const found = detectRecurringBills(allTxs).filter((s) => !existingKeys.has(s.key));
    if (found.length === 0) {
      toast({ description: "No new recurring bills detected. All patterns are already tracked." });
      return;
    }
    setSuggestions(found);
    setSelected(new Set(found.map((s) => s.key)));
    setDetectOpen(true);
  };

  const handleAddSuggestions = async () => {
    const toAdd = suggestions.filter((s) => selected.has(s.key));
    if (toAdd.length === 0) return;
    setAddingAll(true);
    for (const s of toAdd) {
      await addBill.mutateAsync({ name: s.name, amount: s.amount, dueDay: s.dueDay, category: s.category, isRecurring: true, isPaid: false });
    }
    setAddingAll(false);
    setDetectOpen(false);
    toast({ title: "Bills added", description: `Added ${toAdd.length} recurring bill${toAdd.length !== 1 ? "s" : ""}.` });
  };

  const handleSave = () => {
    if (!formData.name || !formData.amount) return;
    const payload = {
      name: formData.name,
      amount: parseFloat(formData.amount),
      dueDay: parseInt(formData.dueDay),
      category: formData.category,
      isRecurring: formData.isRecurring,
      isPaid: false,
      ...(formData.isRecurring ? {} : { month: selectedMonth }),
    };
    if (editingId) { updateBill.mutate({ id: editingId, data: payload }); }
    else { addBill.mutate(payload); }
    setIsDialogOpen(false);
    setFormData(BLANK_FORM);
    setEditingId(null);
  };

  const openEdit = (b: any) => {
    setFormData({ name: b.name, amount: b.amount.toString(), dueDay: b.dueDay.toString(), category: b.category, isRecurring: b.isRecurring });
    setEditingId(b.id);
    setIsDialogOpen(true);
  };

  const togglePaid = (id: string, current: boolean) => updateBill.mutate({ id, data: { isPaid: !current } });

  const savePaycheckDays = () => {
    const d1 = Math.max(1, Math.min(31, parseInt(pcInput[0]) || 1));
    const d2 = Math.max(1, Math.min(31, parseInt(pcInput[1]) || 15));
    setPaycheckDays([d1, d2]);
    setPaycheckEdit(false);
  };

  if (billsLoading || txLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Bill Manager</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            Paid: <span className="text-green-400">${paidAmount.toFixed(2)}</span>
            {" / "}
            Remaining: <span className="text-red-400">${remaining.toFixed(2)}</span>
            {" / "}
            Total: <span className="text-primary">${totalAmount.toFixed(2)}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleScan} className="font-mono text-xs uppercase tracking-wider">
            <ScanSearch className="h-4 w-4 mr-2" /> Detect Bills
          </Button>
          <Button onClick={() => { setFormData(BLANK_FORM); setEditingId(null); setIsDialogOpen(true); }} className="font-mono text-xs uppercase tracking-wider">
            <Plus className="h-4 w-4 mr-2" /> Add Bill
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Paycheck Windows
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {paycheckEdit ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="font-mono text-xs text-muted-foreground w-24">Check 1 Day</Label>
                  <Input type="number" min="1" max="31" value={pcInput[0]} onChange={(e) => setPcInput([e.target.value, pcInput[1]])} className="font-mono bg-input border-border h-8 w-20 text-sm" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="font-mono text-xs text-muted-foreground w-24">Check 2 Day</Label>
                  <Input type="number" min="1" max="31" value={pcInput[1]} onChange={(e) => setPcInput([pcInput[0], e.target.value])} className="font-mono bg-input border-border h-8 w-20 text-sm" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={savePaycheckDays} className="font-mono text-xs uppercase h-7">Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setPaycheckEdit(false)} className="font-mono text-xs uppercase h-7">Cancel</Button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setPcInput([String(pc1), String(pc2)]); setPaycheckEdit(true); }} className="text-left w-full group">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-xs text-muted-foreground">Window 1 (Day {pc1}–{pc2 - 1})</span>
                    <span className="font-mono font-bold text-sm">${window1Bills.reduce((s, b) => s + b.amount, 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-xs text-muted-foreground">Window 2 (Day {pc2}–31)</span>
                    <span className="font-mono font-bold text-sm">${window2Bills.reduce((s, b) => s + b.amount, 0).toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground group-hover:text-primary transition-colors">Tap to change paycheck days</p>
                </div>
              </button>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between font-mono text-sm">
                <span className="text-muted-foreground">Total Bills</span>
                <span>${totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-mono text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="text-green-400">${paidAmount.toFixed(2)}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 mt-3">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: totalAmount > 0 ? `${Math.min((paidAmount / totalAmount) * 100, 100)}%` : "0%" }}
                />
              </div>
              <p className="text-xs font-mono text-muted-foreground text-right">
                {totalAmount > 0 ? Math.round((paidAmount / totalAmount) * 100) : 0}% paid
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Bill Schedule — {selectedMonth}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {monthlyBills.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground font-mono text-sm">
              No bills tracked. Add bills manually or use Detect Bills.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {monthlyBills.map((bill) => {
                const todayDay = new Date().getDate();
                const isOverdue = !bill.isPaid && bill.dueDay < todayDay;
                const isDueToday = !bill.isPaid && bill.dueDay === todayDay;
                const isDueSoon = !bill.isPaid && bill.dueDay > todayDay && bill.dueDay - todayDay <= 3;
                return (
                <div key={bill.id} className={`flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/30 ${bill.isPaid ? "opacity-50" : isOverdue ? "bg-red-500/5" : isDueToday ? "bg-yellow-500/5" : ""}`}>
                  <div className="w-10 text-center">
                    <span className={`font-mono text-lg font-bold ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : "text-muted-foreground"}`}>{bill.dueDay}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-mono text-sm truncate ${bill.isPaid ? "line-through text-muted-foreground" : ""}`}>{bill.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground font-mono">{bill.isRecurring ? "Monthly" : selectedMonth}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground font-mono">{bill.category}</span>
                      {isOverdue && <span className="text-xs font-mono text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">OVERDUE</span>}
                      {isDueToday && <span className="text-xs font-mono text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">TODAY</span>}
                      {isDueSoon && <span className="text-xs font-mono text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded">SOON</span>}
                    </div>
                  </div>
                  <span className="font-mono font-bold text-sm">${bill.amount.toFixed(2)}</span>
                  <button onClick={() => togglePaid(bill.id, bill.isPaid)} className="text-muted-foreground hover:text-primary transition-colors">
                    {bill.isPaid ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5" />}
                  </button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => openEdit(bill)}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteBill.mutate(bill.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detectOpen} onOpenChange={setDetectOpen}>
        <DialogContent className="sm:max-w-[500px] bg-card border-border max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Detected Recurring Bills</DialogTitle>
            <p className="text-xs text-muted-foreground font-mono">These merchants appeared consistently across multiple months. Select which to add.</p>
          </DialogHeader>
          {suggestions.length === 0 ? (
            <p className="text-sm font-mono text-muted-foreground py-4 text-center">No new recurring patterns found.</p>
          ) : (
            <div className="space-y-1 py-2">
              <div className="flex justify-between text-xs font-mono text-muted-foreground uppercase px-1 pb-1 border-b border-border">
                <span>Merchant</span>
                <div className="flex gap-8 mr-2">
                  <span>Day</span>
                  <span>Amount</span>
                </div>
              </div>
              {suggestions.map((s) => (
                <label key={s.key} className="flex items-center gap-3 px-1 py-2 cursor-pointer hover:bg-muted/30 rounded">
                  <input
                    type="checkbox"
                    checked={selected.has(s.key)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(s.key); else next.delete(s.key);
                      setSelected(next);
                    }}
                    className="accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">Seen in {s.monthCount} months</p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground w-10 text-center">Day {s.dueDay}</span>
                  <span className="font-mono font-bold text-sm w-20 text-right">${s.amount.toFixed(2)}</span>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-between items-center pt-2">
            <button onClick={() => setSelected(selected.size === suggestions.length ? new Set() : new Set(suggestions.map(s => s.key)))}
              className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors">
              {selected.size === suggestions.length ? "Deselect All" : "Select All"}
            </button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDetectOpen(false)} className="font-mono text-xs uppercase h-8">Cancel</Button>
              <Button onClick={handleAddSuggestions} disabled={selected.size === 0 || addingAll} className="font-mono text-xs uppercase h-8">
                {addingAll && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                Add {selected.size} Bill{selected.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setFormData(BLANK_FORM); setEditingId(null); } }}>
        <DialogContent className="sm:max-w-[425px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">{editingId ? "Edit Bill" : "New Bill"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Name</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="font-mono bg-input border-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Amount</Label>
                <Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="font-mono bg-input border-border" />
              </div>
              <div className="grid gap-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Due Day</Label>
                <Input type="number" min="1" max="31" value={formData.dueDay} onChange={(e) => setFormData({ ...formData, dueDay: e.target.value })} className="font-mono bg-input border-border" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Category</Label>
              <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value as TransactionCategory })}
                className="flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm font-mono shadow-sm">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Recurring Monthly</Label>
              <Switch checked={formData.isRecurring} onCheckedChange={(c) => setFormData({ ...formData, isRecurring: c })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="font-mono uppercase text-xs">Cancel</Button>
            <Button onClick={handleSave} className="font-mono uppercase text-xs" disabled={addBill.isPending || updateBill.isPending}>
              {(addBill.isPending || updateBill.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
