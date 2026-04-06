import { useState, useEffect, useMemo } from "react";
import { useBills, useAddBill, useUpdateBill, useDeleteBill, useTransactions } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2, Plus, Edit2, Trash2, CheckCircle2, Circle, ScanSearch,
  Settings2, Wrench, Trash, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TransactionCategory, Transaction, Bill } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

interface SuggestedBill {
  key: string;
  name: string;
  amount: number;
  dueDay: number;
  category: TransactionCategory;
  monthCount: number;
  confidence: "recurring" | "likely";
  sourceMonth: string;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join(" ");
}

function isPaidInMonth(bill: Bill, month: string): boolean {
  if (bill.paidMonths) return bill.paidMonths.includes(month);
  return bill.isPaid;
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
      const days = txs.map((t) => parseInt(t.date.split("/")[1] ?? "1", 10)).filter((d) => d >= 1 && d <= 31);
      if (!days.length) continue;
      const avgDay = days.reduce((a, b) => a + b, 0) / days.length;
      const dayStdDev = Math.sqrt(days.reduce((s, d) => s + (d - avgDay) ** 2, 0) / days.length);
      if (dayStdDev > 8) continue;
      const amounts = txs.map((t) => t.amount);
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      if (avgAmount < 10) continue;
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

const BLANK_FORM = {
  name: "", amount: "", dueDay: "1",
  category: "Bills" as TransactionCategory, isRecurring: true,
};

export default function BillsPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: bills, isLoading: billsLoading } = useBills();
  const { data: allTxs, isLoading: txLoading } = useTransactions();
  const addBill = useAddBill();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();
  const { toast } = useToast();

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

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(BLANK_FORM);
  const [confirmAction, setConfirmAction] = useState<null | "fix" | "clear">(null);
  const [isRunningBulk, setIsRunningBulk] = useState(false);

  const [recurringCollapsed, setRecurringCollapsed] = useState(false);
  const [monthSpecificCollapsed, setMonthSpecificCollapsed] = useState(false);

  useEffect(() => { localStorage.setItem("paycheckDays", JSON.stringify(paycheckDays)); }, [paycheckDays]);

  const todayDay = new Date().getDate();

  const recurringBills = useMemo(
    () => (bills || []).filter((b) => b.isRecurring).sort((a, b) => a.dueDay - b.dueDay),
    [bills]
  );

  const monthSpecificBills = useMemo(
    () => (bills || []).filter((b) => !b.isRecurring && b.month === selectedMonth).sort((a, b) => a.dueDay - b.dueDay),
    [bills, selectedMonth]
  );

  const allMonthBills = useMemo(
    () => [...recurringBills, ...monthSpecificBills],
    [recurringBills, monthSpecificBills]
  );

  const totalAmount = allMonthBills.reduce((s, b) => s + b.amount, 0);
  const paidAmount = allMonthBills.filter((b) => isPaidInMonth(b, selectedMonth)).reduce((s, b) => s + b.amount, 0);
  const remaining = totalAmount - paidAmount;

  const [pc1, pc2] = paycheckDays;
  const paycheckConfigured = pc1 > 0 && pc2 > 0 && pc1 !== pc2;

  const window1Bills = paycheckConfigured
    ? allMonthBills.filter((b) => pc1 < pc2 ? (b.dueDay >= pc1 && b.dueDay < pc2) : (b.dueDay >= pc1 || b.dueDay < pc2))
    : [];
  const window2Bills = paycheckConfigured
    ? allMonthBills.filter((b) => pc1 < pc2 ? (b.dueDay >= pc2 || b.dueDay < pc1) : (b.dueDay >= pc2 && b.dueDay < pc1))
    : [];

  const togglePaid = (bill: Bill) => {
    if (bill.isRecurring) {
      const existingPaid = bill.paidMonths ?? (bill.isPaid ? [] : []);
      const currently = isPaidInMonth(bill, selectedMonth);
      const newPaidMonths = currently
        ? existingPaid.filter((m) => m !== selectedMonth)
        : [...existingPaid, selectedMonth];
      updateBill.mutate({ id: bill.id, data: { paidMonths: newPaidMonths } });
    } else {
      updateBill.mutate({ id: bill.id, data: { isPaid: !bill.isPaid } });
    }
  };

  const markAllPaid = () => {
    for (const bill of allMonthBills) {
      if (isPaidInMonth(bill, selectedMonth)) continue;
      if (bill.isRecurring) {
        const existingPaid = bill.paidMonths ?? [];
        updateBill.mutate({ id: bill.id, data: { paidMonths: [...existingPaid, selectedMonth] } });
      } else {
        updateBill.mutate({ id: bill.id, data: { isPaid: true } });
      }
    }
  };

  const handleScan = () => {
    if (!allTxs || allTxs.length === 0) {
      toast({ description: "Import transactions first to scan for recurring bills." });
      return;
    }
    const uniqueMonths = new Set(allTxs.map((t) => t.month)).size;
    const existingKeys = new Set((bills || []).map((b) => normalizeName(b.name)));
    const found = detectRecurringBills(allTxs).filter((s) => !existingKeys.has(s.key));
    if (found.length === 0) {
      toast({ description: `Scanned ${allTxs.length} transactions across ${uniqueMonths} month${uniqueMonths !== 1 ? "s" : ""}. No new bill patterns found.` });
      return;
    }
    setSuggestions(found);
    setScanStats({ total: allTxs.length, months: uniqueMonths });
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
    let recurringCount = 0, monthSpecificCount = 0;
    for (const s of toAdd) {
      const isRecurring = perItemRecurring[s.key] ?? (s.confidence === "recurring");
      const billData: any = { name: s.name, amount: s.amount, dueDay: s.dueDay, category: s.category, isRecurring, isPaid: false };
      if (!isRecurring) { billData.month = s.sourceMonth || selectedMonth; monthSpecificCount++; }
      else recurringCount++;
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
      amount: Math.abs(parseFloat(formData.amount)),
      dueDay: parseInt(formData.dueDay),
      category: formData.category,
      isRecurring: formData.isRecurring,
      isPaid: false,
      ...(formData.isRecurring ? {} : { month: selectedMonth }),
    };
    if (editingId) {
      updateBill.mutate({ id: editingId, data: payload });
      toast({ description: "Bill updated." });
    } else {
      addBill.mutate(payload);
      toast({ description: "Bill added." });
    }
    setIsDialogOpen(false);
    setFormData(BLANK_FORM);
    setEditingId(null);
  };

  const openEdit = (b: Bill) => {
    setFormData({ name: b.name, amount: b.amount.toString(), dueDay: b.dueDay.toString(), category: b.category, isRecurring: b.isRecurring });
    setEditingId(b.id);
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteBill.mutate(id);
    toast({ description: "Bill deleted." });
  };

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
      } else if (uniqueMonths.size === 1 && bill.isRecurring && uniqueMonths.size > 0) {
        const sourceMonth = Array.from(uniqueMonths)[0];
        await updateBill.mutateAsync({ id: bill.id, data: { isRecurring: false, month: sourceMonth } });
        fixed++;
      }
    }
    setIsRunningBulk(false);
    toast({ title: "Bills updated", description: fixed > 0 ? `Fixed ${fixed} bill${fixed !== 1 ? "s" : ""}. Multi-month = recurring; single-month = month-specific.` : "All bills already have the correct type." });
  };

  const handleClearAllBills = async () => {
    if (!bills) return;
    setIsRunningBulk(true);
    setConfirmAction(null);
    for (const bill of bills) { await deleteBill.mutateAsync(bill.id); }
    setIsRunningBulk(false);
    toast({ description: "All bills cleared." });
  };

  const openPaycheckSetup = () => {
    setPcInput([pc1 > 0 ? String(pc1) : "", pc2 > 0 ? String(pc2) : ""]);
    setPaycheckOpen(true);
  };

  const savePaycheckDays = () => {
    const d1 = Math.max(1, Math.min(31, parseInt(pcInput[0]) || 0));
    const d2 = Math.max(1, Math.min(31, parseInt(pcInput[1]) || 0));
    if (!d1 || !d2 || d1 === d2) {
      toast({ variant: "destructive", description: "Enter two different days (1–31)." });
      return;
    }
    setPaycheckDays([d1, d2]);
    setPaycheckOpen(false);
    toast({ description: `Paycheck windows set: Day ${d1} and Day ${d2}.` });
  };

  if (billsLoading || txLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const BillRow = ({ bill, compact = false }: { bill: Bill; compact?: boolean }) => {
    const paid = isPaidInMonth(bill, selectedMonth);
    const isOverdue = !paid && bill.dueDay < todayDay;
    const isDueToday = !paid && bill.dueDay === todayDay;
    const isDueSoon = !paid && bill.dueDay > todayDay && bill.dueDay - todayDay <= 3;
    return (
      <div className={`flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/20 ${paid ? "opacity-50" : isOverdue ? "bg-red-500/5" : isDueToday ? "bg-yellow-500/5" : ""}`}>
        <div className="w-8 text-center flex-shrink-0">
          <span className={`font-mono text-sm font-bold ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : "text-muted-foreground"}`}>{bill.dueDay}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-mono text-sm truncate ${paid ? "line-through text-muted-foreground" : ""}`}>{bill.name}</p>
          {!compact && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground font-mono uppercase">{bill.category}</span>
              {isOverdue && <span className="text-[10px] font-mono text-red-400 bg-red-500/10 px-1 rounded">OVERDUE</span>}
              {isDueToday && <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 px-1 rounded">TODAY</span>}
              {isDueSoon && <span className="text-[10px] font-mono text-orange-400 bg-orange-500/10 px-1 rounded">SOON</span>}
            </div>
          )}
        </div>
        <span className={`font-mono font-bold text-sm flex-shrink-0 ${paid ? "text-muted-foreground" : ""}`}>${bill.amount.toFixed(2)}</span>
        <button onClick={() => togglePaid(bill)} className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0" title={paid ? "Mark unpaid" : "Mark paid"}>
          {paid ? <CheckCircle2 className="w-5 h-5 text-green-500" /> : <Circle className="w-5 h-5" />}
        </button>
        {!compact && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => openEdit(bill)} title="Edit">
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0" onClick={() => handleDelete(bill.id)} title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    );
  };

  const SectionHeader = ({
    title, count, total, paidTotal, collapsed, onToggle,
  }: { title: string; count: number; total: number; paidTotal: number; collapsed: boolean; onToggle: () => void }) => (
    <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-muted/10 select-none" onClick={onToggle}>
      <div className="flex items-center gap-2">
        {collapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="font-mono text-xs text-muted-foreground/50">({count})</span>
      </div>
      <div className="text-right">
        <span className="font-mono text-sm font-bold">${total.toFixed(2)}</span>
        {paidTotal > 0 && <span className="font-mono text-xs text-green-400 ml-2">${paidTotal.toFixed(2)} paid</span>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Bill Manager</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            <span className="text-primary">{selectedMonth}</span>
            {" · "}
            Paid: <span className="text-green-400">${paidAmount.toFixed(2)}</span>
            {" · "}
            Remaining: <span className="text-red-400">${remaining.toFixed(2)}</span>
            {" · "}
            Total: <span className="text-primary">${totalAmount.toFixed(2)}</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={openPaycheckSetup} className="font-mono text-xs uppercase tracking-wider">
            <Settings2 className="h-4 w-4 mr-2" /> Paycheck
          </Button>
          <Button variant="outline" onClick={handleScan} className="font-mono text-xs uppercase tracking-wider">
            <ScanSearch className="h-4 w-4 mr-2" /> Detect
          </Button>
          {(bills || []).length > 0 && (
            <Button variant="outline" onClick={() => setConfirmAction("fix")} disabled={isRunningBulk} className="font-mono text-xs uppercase tracking-wider border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10">
              {isRunningBulk ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
              Fix Types
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

      {/* Progress bar */}
      {allMonthBills.length > 0 && (
        <div className="space-y-2">
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="h-2 rounded-full bg-green-500 transition-all"
              style={{ width: `${totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-muted-foreground">
              {allMonthBills.filter(b => isPaidInMonth(b, selectedMonth)).length} of {allMonthBills.length} paid
            </span>
            <Button variant="ghost" size="sm" onClick={markAllPaid} className="h-7 font-mono text-xs text-muted-foreground hover:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark All Paid
            </Button>
          </div>
        </div>
      )}

      {/* Paycheck Planner */}
      {paycheckConfigured && allMonthBills.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { label: `Paycheck 1 — Day ${pc1}`, wBills: window1Bills, color: "border-primary/30" },
            { label: `Paycheck 2 — Day ${pc2}`, wBills: window2Bills, color: "border-blue-500/30" },
          ].map(({ label, wBills, color }) => {
            const wTotal = wBills.reduce((s, b) => s + b.amount, 0);
            const wPaid = wBills.filter((b) => isPaidInMonth(b, selectedMonth)).reduce((s, b) => s + b.amount, 0);
            return (
              <Card key={label} className={`border-2 ${color}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
                    <div className="text-right">
                      <p className="font-mono font-bold">${wTotal.toFixed(2)}</p>
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
      )}

      {/* Bill sections */}
      {allMonthBills.length === 0 ? (
        <Card className="border-dashed border-2 border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4 text-center">
            <ScanSearch className="w-10 h-10 text-muted-foreground" />
            <div>
              <p className="font-mono text-sm text-muted-foreground">No bills tracked yet.</p>
              <p className="font-mono text-xs text-muted-foreground/60 mt-1">Use Detect to find recurring bills from your transactions, or add one manually.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleScan} className="font-mono text-xs uppercase">
                <ScanSearch className="h-3.5 w-3.5 mr-2" /> Detect Bills
              </Button>
              <Button size="sm" onClick={() => { setFormData(BLANK_FORM); setEditingId(null); setIsDialogOpen(true); }} className="font-mono text-xs uppercase">
                <Plus className="h-3.5 w-3.5 mr-2" /> Add Manually
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* SECTION 1: Monthly Recurring */}
          <Card className="border-border">
            <div className="border-b border-border">
              <SectionHeader
                title="Monthly Recurring"
                count={recurringBills.length}
                total={recurringBills.reduce((s, b) => s + b.amount, 0)}
                paidTotal={recurringBills.filter(b => isPaidInMonth(b, selectedMonth)).reduce((s, b) => s + b.amount, 0)}
                collapsed={recurringCollapsed}
                onToggle={() => setRecurringCollapsed(!recurringCollapsed)}
              />
            </div>
            {!recurringCollapsed && (
              recurringBills.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm font-mono text-muted-foreground">
                  No recurring bills. Run Detect or add one manually.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recurringBills.map((b) => <BillRow key={b.id} bill={b} />)}
                </div>
              )
            )}
          </Card>

          {/* SECTION 2: Month-Specific */}
          <Card className="border-border">
            <div className="border-b border-border">
              <SectionHeader
                title={`This Month Only — ${selectedMonth}`}
                count={monthSpecificBills.length}
                total={monthSpecificBills.reduce((s, b) => s + b.amount, 0)}
                paidTotal={monthSpecificBills.filter(b => isPaidInMonth(b, selectedMonth)).reduce((s, b) => s + b.amount, 0)}
                collapsed={monthSpecificCollapsed}
                onToggle={() => setMonthSpecificCollapsed(!monthSpecificCollapsed)}
              />
            </div>
            {!monthSpecificCollapsed && (
              monthSpecificBills.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm font-mono text-muted-foreground">
                  No month-specific bills for {selectedMonth}.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {monthSpecificBills.map((b) => <BillRow key={b.id} bill={b} />)}
                </div>
              )
            )}
          </Card>
        </div>
      )}

      {/* Confirm: Fix Bill Types */}
      <Dialog open={confirmAction === "fix"} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[400px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Fix Bill Types?</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-mono text-muted-foreground">
            This will scan your transaction history and re-classify each bill. Bills found in multiple months become <span className="text-primary">Recurring</span>. Bills found in only one month become <span className="text-yellow-400">Month-Specific</span>.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button onClick={handleFixBillTypes} disabled={isRunningBulk} className="font-mono text-xs uppercase bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 hover:bg-yellow-500/30">
              {isRunningBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
              Fix Now
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm: Clear All */}
      <Dialog open={confirmAction === "clear"} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[400px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-destructive tracking-wider text-sm">Clear All Bills?</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-mono text-muted-foreground">
            This will permanently delete all {(bills || []).length} bill{(bills || []).length !== 1 ? "s" : ""}. You can re-add them using Detect Bills.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button onClick={handleClearAllBills} disabled={isRunningBulk} variant="destructive" className="font-mono text-xs uppercase">
              {isRunningBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash className="w-4 h-4 mr-2" />}
              Delete All
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Paycheck Setup Dialog */}
      <Dialog open={paycheckOpen} onOpenChange={setPaycheckOpen}>
        <DialogContent className="sm:max-w-[360px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Paycheck Days</DialogTitle>
          </DialogHeader>
          <p className="text-xs font-mono text-muted-foreground">Enter the day-of-month you get paid (e.g., 1 and 15 for bi-monthly).</p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <Label className="font-mono text-xs uppercase text-muted-foreground">Paycheck 1 Day</Label>
              <Input type="number" min="1" max="31" placeholder="e.g. 1" value={pcInput[0]} onChange={(e) => setPcInput([e.target.value, pcInput[1]])} className="font-mono mt-1 bg-input border-border" />
            </div>
            <div>
              <Label className="font-mono text-xs uppercase text-muted-foreground">Paycheck 2 Day</Label>
              <Input type="number" min="1" max="31" placeholder="e.g. 15" value={pcInput[1]} onChange={(e) => setPcInput([pcInput[0], e.target.value])} className="font-mono mt-1 bg-input border-border" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setPaycheckOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button onClick={savePaycheckDays} className="font-mono text-xs uppercase">Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Bill Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setFormData(BLANK_FORM); setEditingId(null); } }}>
        <DialogContent className="sm:max-w-[420px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">
              {editingId ? "Edit Bill" : "Add Bill"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Bill Name</Label>
              <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Netflix, Rent..." className="font-mono bg-input border-border" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Amount ($)</Label>
                <Input type="number" min="0" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} placeholder="0.00" className="font-mono bg-input border-border" />
              </div>
              <div className="grid gap-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Due Day</Label>
                <Input type="number" min="1" max="31" value={formData.dueDay} onChange={(e) => setFormData({ ...formData, dueDay: e.target.value })} placeholder="1–31" className="font-mono bg-input border-border" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">Category</Label>
              <Select value={formData.category} onValueChange={(v: any) => setFormData({ ...formData, category: v })}>
                <SelectTrigger className="font-mono bg-input border-border"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-mono">Monthly Recurring</p>
                <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{formData.isRecurring ? "Shows every month" : `Only for ${selectedMonth}`}</p>
              </div>
              <Switch checked={formData.isRecurring} onCheckedChange={(v) => setFormData({ ...formData, isRecurring: v })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button onClick={handleSave} disabled={addBill.isPending || updateBill.isPending} className="font-mono text-xs uppercase">
              {(addBill.isPending || updateBill.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingId ? "Update" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detect Bills Dialog */}
      <Dialog open={detectOpen} onOpenChange={setDetectOpen}>
        <DialogContent className="sm:max-w-[540px] bg-card border-border max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Detected Bills</DialogTitle>
            {scanStats && (
              <p className="text-xs text-muted-foreground font-mono mt-1">
                Scanned <span className="text-primary">{scanStats.total}</span> transactions across{" "}
                <span className="text-primary">{scanStats.months}</span> month{scanStats.months !== 1 ? "s" : ""}.
                {" "}Recurring = confirmed multi-month pattern. Likely = appeared once.
              </p>
            )}
          </DialogHeader>
          <div className="space-y-1 py-2">
            <div className="grid grid-cols-[auto,1fr,auto,auto,auto] gap-x-3 text-[10px] font-mono text-muted-foreground uppercase px-1 pb-1 border-b border-border">
              <span></span><span>Name</span><span>Amount</span><span>Day</span><span>Recurring</span>
            </div>
            {suggestions.map((s) => (
              <div key={s.key} className={`grid grid-cols-[auto,1fr,auto,auto,auto] gap-x-3 items-center px-1 py-2 rounded ${selected.has(s.key) ? "bg-primary/5" : "opacity-50"}`}>
                <input type="checkbox" checked={selected.has(s.key)} onChange={(e) => {
                  const next = new Set(selected);
                  e.target.checked ? next.add(s.key) : next.delete(s.key);
                  setSelected(next);
                }} className="w-4 h-4 accent-primary" />
                <div>
                  <p className="font-mono text-xs truncate">{s.name}</p>
                  <p className={`text-[10px] font-mono ${s.confidence === "recurring" ? "text-green-400" : "text-yellow-400"}`}>
                    {s.confidence === "recurring" ? `Confirmed — ${s.monthCount} months` : "Likely — 1 month"}
                  </p>
                </div>
                <span className="font-mono text-xs">${s.amount.toFixed(2)}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.dueDay}</span>
                <Switch
                  checked={perItemRecurring[s.key] ?? s.confidence === "recurring"}
                  onCheckedChange={(v) => setPerItemRecurring({ ...perItemRecurring, [s.key]: v })}
                  disabled={!selected.has(s.key)}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs font-mono text-muted-foreground">{selected.size} of {suggestions.length} selected</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDetectOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
              <Button onClick={handleAddSuggestions} disabled={addingAll || selected.size === 0} className="font-mono text-xs uppercase">
                {addingAll && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add Selected
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
