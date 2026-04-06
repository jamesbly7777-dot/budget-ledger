import { useState, useEffect, useMemo } from "react";
import { useBills, useAddBill, useUpdateBill, useDeleteBill, useTransactions } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Edit2, Trash2, CheckCircle2, Circle, ScanSearch, Settings2, Wrench, Trash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TransactionCategory, Transaction } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

interface SuggestedBill {
  key: string;
  name: string;
  amount: number;
  dueDay: number;
  category: TransactionCategory;
  monthCount: number;
  confidence: "recurring" | "likely";
  sourceMonth: string; // the month this was found in (used when adding as non-recurring)
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")   // strip everything except letters and spaces
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2) // drop noise words like "co", "of", "at"
    .slice(0, 4)                 // keep first 4 meaningful words
    .join(" ");
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

    if (uniqueMonths.size >= 2) {
      // Multi-month: recurring detection
      const days = txs.map((t) => parseInt(t.date.split("/")[1] ?? "1", 10)).filter((d) => d >= 1 && d <= 31);
      if (!days.length) continue;
      const avgDay = days.reduce((a, b) => a + b, 0) / days.length;
      // Allow up to 8 days of variation (billing can shift for weekends/holidays)
      const dayStdDev = Math.sqrt(days.reduce((s, d) => s + (d - avgDay) ** 2, 0) / days.length);
      if (dayStdDev > 8) continue;

      const amounts = txs.map((t) => t.amount);
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      if (avgAmount < 10) continue;
      // Allow up to 50% amount variance (utility bills fluctuate significantly)
      const amtStdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - avgAmount) ** 2, 0) / amounts.length);
      if (amtStdDev / avgAmount > 0.5) continue;

      const nameCounts: Record<string, number> = {};
      txs.forEach((t) => { nameCounts[t.name] = (nameCounts[t.name] ?? 0) + 1; });
      const bestName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1])[0][0];
      const catCounts: Record<string, number> = {};
      txs.forEach((t) => { catCounts[t.category] = (catCounts[t.category] ?? 0) + 1; });
      const bestCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0] as TransactionCategory;

      suggestions.push({ key, name: bestName, amount: Math.round(avgAmount * 100) / 100, dueDay: Math.round(avgDay), category: bestCat, monthCount: uniqueMonths.size, confidence: "recurring", sourceMonth: Array.from(uniqueMonths).sort().pop() ?? "" });
    } else {
      // Single month: suggest Bills-category or any expense ≥ $15 as likely recurring
      const tx = txs[0];
      if (tx.category === "Transfers") continue;
      if (tx.amount < 15) continue;
      const dueDay = parseInt(tx.date.split("/")[1] ?? "1", 10);
      if (dueDay < 1 || dueDay > 31) continue;
      suggestions.push({ key, name: tx.name, amount: tx.amount, dueDay, category: tx.category, monthCount: 1, confidence: "likely", sourceMonth: tx.month });
    }
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

  // Paycheck days: stored in localStorage, 0 = not set
  const [paycheckDays, setPaycheckDays] = useState<[number, number]>(() => {
    try { const s = localStorage.getItem("paycheckDays"); return s ? JSON.parse(s) : [0, 0]; }
    catch { return [0, 0]; }
  });
  const [paycheckOpen, setPaycheckOpen] = useState(false);
  const [pcInput, setPcInput] = useState<[string, string]>(["", ""]);

  const [detectOpen, setDetectOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedBill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [perItemRecurring, setPerItemRecurring] = useState<Record<string, boolean>>({});
  const [addingAll, setAddingAll] = useState(false);
  const [scanStats, setScanStats] = useState<{ total: number; months: number } | null>(null);
  const [billFilter, setBillFilter] = useState<"all" | "unpaid" | "paid">("all");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(BLANK_FORM);
  const [confirmAction, setConfirmAction] = useState<null | "fix" | "clear">(null);
  const [isRunningBulk, setIsRunningBulk] = useState(false);

  useEffect(() => {
    localStorage.setItem("paycheckDays", JSON.stringify(paycheckDays));
  }, [paycheckDays]);

  const monthlyBills = useMemo(
    () => (bills || []).filter((b) => b.isRecurring || b.month === selectedMonth).sort((a, b) => a.dueDay - b.dueDay),
    [bills, selectedMonth]
  );

  const filteredBills = useMemo(() => {
    if (billFilter === "paid") return monthlyBills.filter((b) => b.isPaid);
    if (billFilter === "unpaid") return monthlyBills.filter((b) => !b.isPaid);
    return monthlyBills;
  }, [monthlyBills, billFilter]);

  const totalAmount = monthlyBills.reduce((s, b) => s + b.amount, 0);
  const paidAmount = monthlyBills.filter((b) => b.isPaid).reduce((s, b) => s + b.amount, 0);
  const remaining = totalAmount - paidAmount;

  const [pc1, pc2] = paycheckDays;
  const paycheckConfigured = pc1 > 0 && pc2 > 0 && pc1 !== pc2;

  // Bills in each paycheck window
  const window1Bills = paycheckConfigured
    ? monthlyBills.filter((b) => pc1 < pc2 ? (b.dueDay >= pc1 && b.dueDay < pc2) : (b.dueDay >= pc1 || b.dueDay < pc2))
    : [];
  const window2Bills = paycheckConfigured
    ? monthlyBills.filter((b) => pc1 < pc2 ? (b.dueDay >= pc2 || b.dueDay < pc1) : (b.dueDay >= pc2 && b.dueDay < pc1))
    : [];

  const todayDay = new Date().getDate();

  const handleScan = () => {
    if (!allTxs || allTxs.length === 0) {
      toast({ description: "Import transactions first to scan for recurring bills." });
      return;
    }
    const uniqueMonths = new Set(allTxs.map((t) => t.month)).size;
    const existingKeys = new Set((bills || []).map((b) => normalizeName(b.name)));
    const found = detectRecurringBills(allTxs).filter((s) => !existingKeys.has(s.key));
    if (found.length === 0) {
      toast({
        description: `Scanned ${allTxs.length} transactions across ${uniqueMonths} month${uniqueMonths !== 1 ? "s" : ""}. No new bill patterns found — try adding bills manually.`,
      });
      return;
    }
    setSuggestions(found);
    setScanStats({ total: allTxs.length, months: uniqueMonths });
    // Pre-select all; default recurring ON for multi-month, OFF for single-month
    setSelected(new Set(found.map((s) => s.key)));
    const initRecurring: Record<string, boolean> = {};
    found.forEach((s) => { initRecurring[s.key] = s.confidence === "recurring"; });
    setPerItemRecurring(initRecurring);
    setDetectOpen(true);
  };

  const handleAddSuggestions = async () => {
    const toAdd = suggestions.filter((s) => selected.has(s.key));
    if (!toAdd.length) return;
    setAddingAll(true);
    let recurringCount = 0;
    let monthSpecificCount = 0;
    for (const s of toAdd) {
      const isRecurring = perItemRecurring[s.key] ?? (s.confidence === "recurring");
      const billData: any = { name: s.name, amount: s.amount, dueDay: s.dueDay, category: s.category, isRecurring, isPaid: false };
      if (!isRecurring) {
        billData.month = s.sourceMonth || selectedMonth;
        monthSpecificCount++;
      } else {
        recurringCount++;
      }
      await addBill.mutateAsync(billData);
    }
    setAddingAll(false);
    setDetectOpen(false);
    const parts = [];
    if (recurringCount) parts.push(`${recurringCount} recurring`);
    if (monthSpecificCount) parts.push(`${monthSpecificCount} month-specific`);
    toast({ title: "Bills added", description: `Added ${parts.join(", ")} bill${toAdd.length !== 1 ? "s" : ""}.` });
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
    if (editingId) updateBill.mutate({ id: editingId, data: payload });
    else addBill.mutate(payload);
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

  const handleFixBillTypes = async () => {
    if (!allTxs || !bills) return;
    setIsRunningBulk(true);
    setConfirmAction(null);
    let fixed = 0;
    for (const bill of bills) {
      const key = normalizeName(bill.name);
      const matchingTxs = allTxs.filter((t) => normalizeName(t.name) === key);
      const uniqueMonths = new Set(matchingTxs.map((t) => t.month));
      if (uniqueMonths.size >= 2 && !bill.isRecurring) {
        await updateBill.mutateAsync({ id: bill.id, data: { isRecurring: true, month: undefined } });
        fixed++;
      } else if (uniqueMonths.size === 1 && bill.isRecurring) {
        const sourceMonth = Array.from(uniqueMonths)[0];
        await updateBill.mutateAsync({ id: bill.id, data: { isRecurring: false, month: sourceMonth } });
        fixed++;
      }
    }
    setIsRunningBulk(false);
    toast({ title: "Bills updated", description: fixed > 0 ? `Fixed ${fixed} bill${fixed !== 1 ? "s" : ""}. Recurring bills now show every month; month-specific bills only show in their month.` : "All bills already had the correct type." });
  };

  const handleClearAllBills = async () => {
    if (!bills) return;
    setIsRunningBulk(true);
    setConfirmAction(null);
    for (const bill of bills) {
      await deleteBill.mutateAsync(bill.id);
    }
    setIsRunningBulk(false);
    toast({ description: "All bills cleared. Run Detect Bills to re-add them." });
  };

  const openPaycheckSetup = () => {
    setPcInput([pc1 > 0 ? String(pc1) : "", pc2 > 0 ? String(pc2) : ""]);
    setPaycheckOpen(true);
  };

  const savePaycheckDays = () => {
    const d1 = Math.max(1, Math.min(31, parseInt(pcInput[0]) || 0));
    const d2 = Math.max(1, Math.min(31, parseInt(pcInput[1]) || 0));
    if (!d1 || !d2 || d1 === d2) {
      toast({ variant: "destructive", description: "Enter two different days (1–31) for your paycheck dates." });
      return;
    }
    setPaycheckDays([d1, d2]);
    setPaycheckOpen(false);
    toast({ description: `Paycheck windows set: Day ${d1} and Day ${d2}.` });
  };

  if (billsLoading || txLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const BillRow = ({ bill, compact = false }: { bill: any; compact?: boolean }) => {
    const isOverdue = !bill.isPaid && bill.dueDay < todayDay;
    const isDueToday = !bill.isPaid && bill.dueDay === todayDay;
    const isDueSoon = !bill.isPaid && bill.dueDay > todayDay && bill.dueDay - todayDay <= 3;
    return (
      <div className={`flex items-center gap-3 ${compact ? "px-4 py-2" : "px-6 py-3"} transition-colors hover:bg-muted/30 ${bill.isPaid ? "opacity-50" : isOverdue ? "bg-red-500/5" : isDueToday ? "bg-yellow-500/5" : ""}`}>
        <div className="w-8 text-center flex-shrink-0">
          <span className={`font-mono text-base font-bold ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : "text-muted-foreground"}`}>{bill.dueDay}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-mono text-sm truncate ${bill.isPaid ? "line-through text-muted-foreground" : ""}`}>{bill.name}</p>
          {!compact && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs text-muted-foreground font-mono">{bill.category}</span>
              {isOverdue && <span className="text-xs font-mono text-red-400 bg-red-500/10 px-1 rounded">OVERDUE</span>}
              {isDueToday && <span className="text-xs font-mono text-yellow-400 bg-yellow-500/10 px-1 rounded">TODAY</span>}
              {isDueSoon && <span className="text-xs font-mono text-orange-400 bg-orange-500/10 px-1 rounded">SOON</span>}
            </div>
          )}
        </div>
        <span className={`font-mono font-bold text-sm ${bill.isPaid ? "text-muted-foreground" : ""}`}>${bill.amount.toFixed(2)}</span>
        <button onClick={() => togglePaid(bill.id, bill.isPaid)} className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
          {bill.isPaid ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5" />}
        </button>
        {!compact && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => openEdit(bill)}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0" onClick={() => deleteBill.mutate(bill.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Bill Manager</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            Paid: <span className="text-green-400">${paidAmount.toFixed(2)}</span>
            {" · "}
            Remaining: <span className="text-red-400">${remaining.toFixed(2)}</span>
            {" · "}
            Total: <span className="text-primary">${totalAmount.toFixed(2)}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={openPaycheckSetup} className="font-mono text-xs uppercase tracking-wider">
            <Settings2 className="h-4 w-4 mr-2" /> Paycheck Setup
          </Button>
          <Button variant="outline" onClick={handleScan} className="font-mono text-xs uppercase tracking-wider">
            <ScanSearch className="h-4 w-4 mr-2" /> Detect Bills
          </Button>
          {(bills || []).length > 0 && (
            <Button variant="outline" onClick={() => setConfirmAction("fix")} disabled={isRunningBulk} className="font-mono text-xs uppercase tracking-wider border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10">
              {isRunningBulk && confirmAction === null ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
              Fix Bill Types
            </Button>
          )}
          {(bills || []).length > 0 && (
            <Button variant="outline" onClick={() => setConfirmAction("clear")} disabled={isRunningBulk} className="font-mono text-xs uppercase tracking-wider border-red-500/40 text-red-400 hover:bg-red-500/10">
              <Trash className="h-4 w-4 mr-2" /> Clear All
            </Button>
          )}
          <Button onClick={() => { setFormData(BLANK_FORM); setEditingId(null); setIsDialogOpen(true); }} className="font-mono text-xs uppercase tracking-wider">
            <Plus className="h-4 w-4 mr-2" /> Add Bill
          </Button>
        </div>
      </div>

      {/* Paycheck Planner */}
      {paycheckConfigured ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: `Paycheck 1 — Day ${pc1}`, bills: window1Bills, color: "border-primary/30" },
            { label: `Paycheck 2 — Day ${pc2}`, bills: window2Bills, color: "border-blue-500/30" },
          ].map(({ label, bills: wBills, color }) => {
            const wTotal = wBills.reduce((s, b) => s + b.amount, 0);
            const wPaid = wBills.filter((b) => b.isPaid).reduce((s, b) => s + b.amount, 0);
            return (
              <Card key={label} className={`border-2 ${color}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
                    <div className="text-right">
                      <p className="font-mono font-bold text-lg">${wTotal.toFixed(2)}</p>
                      <p className="text-xs font-mono text-green-400">${wPaid.toFixed(2)} paid</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {wBills.length === 0 ? (
                    <p className="text-xs font-mono text-muted-foreground px-4 pb-4">No bills in this window.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {wBills.map((b) => <BillRow key={b.id} bill={b} compact />)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed border-2 border-border">
          <CardContent className="flex flex-col items-center justify-center py-8 text-center gap-3">
            <Settings2 className="w-8 h-8 text-muted-foreground" />
            <p className="font-mono text-sm text-muted-foreground">Set up your paycheck days to see which bills come out of each paycheck.</p>
            <Button variant="outline" onClick={openPaycheckSetup} className="font-mono text-xs uppercase">
              Set Paycheck Days
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Full Bill Schedule */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Bill Schedule — {selectedMonth}
              </CardTitle>
              {monthlyBills.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { const unpaid = monthlyBills.filter((b) => !b.isPaid); unpaid.forEach((b) => updateBill.mutate({ id: b.id, data: { isPaid: true } })); }}
                  className="font-mono text-xs text-muted-foreground hover:text-green-400 h-7"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark All Paid
                </Button>
              )}
            </div>
            {monthlyBills.length > 0 && (
              <>
                <div className="w-full bg-muted rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-green-500 transition-all"
                    style={{ width: `${totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex gap-1">
                  {(["all", "unpaid", "paid"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setBillFilter(f)}
                      className={`font-mono text-xs uppercase px-3 py-1 rounded transition-colors ${billFilter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                    >
                      {f} ({f === "all" ? monthlyBills.length : f === "unpaid" ? monthlyBills.filter(b => !b.isPaid).length : monthlyBills.filter(b => b.isPaid).length})
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {monthlyBills.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-muted-foreground font-mono text-sm">No bills tracked yet for {selectedMonth}.</p>
              <div className="flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={handleScan} className="font-mono text-xs uppercase">
                  <ScanSearch className="h-3.5 w-3.5 mr-2" /> Detect Bills
                </Button>
                <Button size="sm" onClick={() => { setFormData(BLANK_FORM); setEditingId(null); setIsDialogOpen(true); }} className="font-mono text-xs uppercase">
                  <Plus className="h-3.5 w-3.5 mr-2" /> Add Manually
                </Button>
              </div>
            </div>
          ) : filteredBills.length === 0 ? (
            <p className="text-center py-8 font-mono text-sm text-muted-foreground">No {billFilter} bills.</p>
          ) : (
            <div className="divide-y divide-border">
              {filteredBills.map((bill) => <BillRow key={bill.id} bill={bill} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detection Dialog */}
      <Dialog open={detectOpen} onOpenChange={setDetectOpen}>
        <DialogContent className="sm:max-w-[520px] bg-card border-border max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Detected Bills</DialogTitle>
            {scanStats && (
              <p className="text-xs text-muted-foreground font-mono mt-1">
                Scanned <span className="text-primary">{scanStats.total}</span> transactions across{" "}
                <span className="text-primary">{scanStats.months}</span> month{scanStats.months !== 1 ? "s" : ""}.
                {" "}Confirmed recurring are pre-selected. "Likely" items appeared once — review before adding.
              </p>
            )}
          </DialogHeader>
          <div className="space-y-1 py-2">
            <div className="grid grid-cols-[auto,1fr,auto,auto,auto] gap-x-3 text-xs font-mono text-muted-foreground uppercase px-1 pb-1 border-b border-border">
              <span></span><span>Merchant</span><span className="text-center">Day</span><span className="text-right">Amt</span><span className="text-center">Monthly</span>
            </div>
            {suggestions.map((s) => {
              const isRec = perItemRecurring[s.key] ?? (s.confidence === "recurring");
              return (
                <div key={s.key} className="grid grid-cols-[auto,1fr,auto,auto,auto] gap-x-3 items-center px-1 py-2 hover:bg-muted/30 rounded">
                  <input type="checkbox" checked={selected.has(s.key)}
                    onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(s.key) : n.delete(s.key); setSelected(n); }}
                    className="accent-primary w-4 h-4 cursor-pointer" />
                  <div className="min-w-0">
                    <p className="font-mono text-sm truncate">{s.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">
                      {isRec
                        ? <span className="text-primary">Every month · {s.monthCount}mo found</span>
                        : <span className="text-yellow-400">{s.sourceMonth} only</span>}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground text-center">Day {s.dueDay}</span>
                  <span className="font-mono font-bold text-sm text-right">${s.amount.toFixed(2)}</span>
                  <div className="flex justify-center">
                    <Switch
                      checked={isRec}
                      onCheckedChange={(v) => setPerItemRecurring((prev) => ({ ...prev, [s.key]: v }))}
                      className="scale-75"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between items-center pt-2">
            <button onClick={() => setSelected(selected.size === suggestions.length ? new Set() : new Set(suggestions.map((s) => s.key)))}
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

      {/* Paycheck Setup Dialog */}
      <Dialog open={paycheckOpen} onOpenChange={setPaycheckOpen}>
        <DialogContent className="sm:max-w-[360px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Paycheck Setup</DialogTitle>
            <p className="text-xs text-muted-foreground font-mono mt-1">Enter the day of month each paycheck arrives (1–31).</p>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="grid gap-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">First Paycheck — Day of Month</Label>
              <Input type="number" min="1" max="31" placeholder="e.g. 1" value={pcInput[0]}
                onChange={(e) => setPcInput([e.target.value, pcInput[1]])}
                className="font-mono bg-input border-border text-lg" />
            </div>
            <div className="grid gap-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Second Paycheck — Day of Month</Label>
              <Input type="number" min="1" max="31" placeholder="e.g. 15" value={pcInput[1]}
                onChange={(e) => setPcInput([pcInput[0], e.target.value])}
                className="font-mono bg-input border-border text-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPaycheckOpen(false)} className="font-mono text-xs uppercase h-8">Cancel</Button>
            <Button onClick={savePaycheckDays} className="font-mono text-xs uppercase h-8">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog (Fix / Clear) */}
      <Dialog open={confirmAction !== null} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
        <DialogContent className="sm:max-w-[380px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-sm tracking-wider">
              {confirmAction === "fix" ? "Fix Bill Types" : "Clear All Bills"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 text-sm font-mono text-muted-foreground">
            {confirmAction === "fix"
              ? "This will scan your transaction history and automatically set each bill as either recurring (shows every month) or month-specific (shows only in its month). Bills found in 2+ months stay recurring; bills found in 1 month get pinned to that month."
              : `This will permanently delete all ${(bills || []).length} tracked bills. You can re-add them using Detect Bills afterward.`}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="font-mono text-xs uppercase h-8">Cancel</Button>
            <Button
              onClick={confirmAction === "fix" ? handleFixBillTypes : handleClearAllBills}
              className={`font-mono text-xs uppercase h-8 ${confirmAction === "clear" ? "bg-destructive hover:bg-destructive/90" : ""}`}
              disabled={isRunningBulk}
            >
              {isRunningBulk && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              {confirmAction === "fix" ? "Fix Bills" : "Clear All Bills"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Dialog */}
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
                <Label className="font-mono text-xs uppercase text-muted-foreground">Due Day (1–31)</Label>
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
