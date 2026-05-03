import { useState, useMemo } from "react";
import {
  useTransactions, useAddTransaction, useUpdateTransaction,
  useDeleteTransaction, useMonths, useCustomCategories, useSaveCustomCategories,
} from "@/hooks/use-finance";
import { CyberHero } from "@/components/CyberHero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Plus, PlusCircle, Search, Download, Edit2, Trash2, ScanSearch,
  AlertTriangle, Scissors, X, CalendarDays, TrendingUp,
} from "lucide-react";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TransactionStatus, Transaction, DEFAULT_EXPENSE_CATEGORIES, IncomeCategory } from "@/lib/types";
import { exportToCSV } from "@/lib/csvParser";
import { getMonthKey, formatMonthLabel } from "@/lib/rulesEngine";
import { buildMonthOptions } from "@/lib/monthNav";
import {
  detectLikelyDuplicates,
  findPotentialDuplicates,
  computeAuditedMonthTotals,
  filterTransactionsToCalendarMonth,
} from "@/lib/billStatus";
import { useToast } from "@/hooks/use-toast";

const BASE_CATEGORY_COLORS: Record<string, string> = {
  Bills: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Fuel: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Necessary: "bg-green-500/20 text-green-400 border-green-500/30",
  Medical: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Shopping: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  Transfers: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  Personal: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Waste: "bg-red-500/20 text-red-400 border-red-500/30",
  Work: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  Uncategorized: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function getCategoryColor(category: string): string {
  return BASE_CATEGORY_COLORS[category] ?? "bg-violet-500/20 text-violet-400 border-violet-500/30";
}

const BLANK_FORM = {
  date: new Date().toISOString().split("T")[0],
  name: "",
  amount: "",
  category: "Uncategorized",
  status: "cleared" as TransactionStatus,
  note: "",
};

// ─── Split Dialog ─────────────────────────────────────────────────────────────
interface SplitRow {
  id: number;
  label: string;
  amount: string;
  category: string;
}

interface DuplicateGroup {
  id: string;
  transactions: Transaction[];
  suggestedDeleteIds: Set<string>;
}

interface IncomeReclassCandidate {
  tx: Transaction;
  suggestedIncomeCategory: IncomeCategory;
}

interface SplitDialogProps {
  tx: Transaction;
  allCategories: string[];
  onAddCategory: (cat: string) => void;
  onConfirm: (splits: { name: string; amount: number; category: string }[]) => void;
  onClose: () => void;
}

function SplitDialog({ tx, allCategories, onAddCategory, onConfirm, onClose }: SplitDialogProps) {
  const [rows, setRows] = useState<SplitRow[]>([
    { id: 1, label: tx.name, amount: "", category: tx.category },
    { id: 2, label: tx.name, amount: "", category: "Uncategorized" },
  ]);
  const [saving, setSaving] = useState(false);

  const original = Math.abs(tx.amount);
  const allocated = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const remaining = parseFloat((original - allocated).toFixed(2));
  const isValid = Math.abs(remaining) < 0.005 && rows.every((r) => r.label.trim() && parseFloat(r.amount) > 0);

  const updateRow = (id: number, field: keyof SplitRow, val: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)));

  const addRow = () =>
    setRows((prev) => [...prev, { id: Date.now(), label: tx.name, amount: "", category: "Uncategorized" }]);

  const removeRow = (id: number) =>
    setRows((prev) => (prev.length > 2 ? prev.filter((r) => r.id !== id) : prev));

  const handleConfirm = async () => {
    if (!isValid) return;
    setSaving(true);
    onConfirm(rows.map((r) => ({ name: r.label.trim(), amount: parseFloat(r.amount), category: r.category })));
  };

  return (
    <DialogContent className="sm:max-w-[520px] bg-popover/95 border-cyan-500/25 backdrop-blur-xl">
      <DialogHeader>
        <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm flex items-center gap-2">
          <Scissors className="w-4 h-4" /> Split Transaction
        </DialogTitle>
      </DialogHeader>

      <div className="border border-border rounded-md p-3 bg-muted/20 mb-3">
        <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Original</p>
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm truncate max-w-[260px]">{tx.name}</span>
          <span className="font-mono font-bold text-sm">${original.toFixed(2)}</span>
        </div>
        <p className="text-xs font-mono text-muted-foreground mt-0.5">{tx.date} · {tx.month}</p>
      </div>

      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
        {rows.map((row, i) => (
          <div key={row.id} className="border border-border rounded-md p-2.5 space-y-2 bg-muted/10">
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">Part {i + 1}</span>
              {rows.length > 2 && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeRow(row.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="font-mono text-[10px] uppercase text-muted-foreground">Label</Label>
                <Input
                  value={row.label}
                  onChange={(e) => updateRow(row.id, "label", e.target.value)}
                  placeholder="e.g. Groceries"
                  className="font-mono bg-input border-border h-8 text-sm"
                />
              </div>
              <div className="grid gap-1">
                <Label className="font-mono text-[10px] uppercase text-muted-foreground">Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.amount}
                  onChange={(e) => updateRow(row.id, "amount", e.target.value)}
                  placeholder="0.00"
                  className="font-mono bg-input border-border h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid gap-1">
              <Label className="font-mono text-[10px] uppercase text-muted-foreground">Category</Label>
              <CategorySelect
                value={row.category}
                onChange={(v) => updateRow(row.id, "category", v)}
                allCategories={allCategories}
                onAdd={onAddCategory}
                className="h-8 text-sm"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between py-2 border-t border-border mt-1">
        <Button variant="ghost" size="sm" className="font-mono text-xs text-primary" onClick={addRow}>
          <PlusCircle className="w-3.5 h-3.5 mr-1" /> Add Part
        </Button>
        <div className="text-right">
          <p className="text-xs font-mono text-muted-foreground">Remaining</p>
          <p className={`font-mono font-bold text-sm ${remaining === 0 ? "text-emerald-400" : remaining < 0 ? "text-red-400" : "text-yellow-400"}`}>
            ${remaining.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} className="font-mono text-xs uppercase">Cancel</Button>
        <Button
          onClick={handleConfirm}
          disabled={!isValid || saving}
          className="font-mono text-xs uppercase"
        >
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Confirm Split
        </Button>
      </div>
    </DialogContent>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LedgerPage({
  selectedMonth,
  onMonthChange,
}: {
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}) {
  const { data: transactions, isLoading } = useTransactions(selectedMonth);
  const { data: allTransactions } = useTransactions();
  const { data: months } = useMonths();
  const { data: customCats = [] } = useCustomCategories();
  const saveCustomCats = useSaveCustomCategories();
  const addTx = useAddTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [dupDialogOpen, setDupDialogOpen] = useState(false);
  const [removingDups, setRemovingDups] = useState(false);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<string>>(new Set());
  const [incomeReclassOpen, setIncomeReclassOpen] = useState(false);
  const [reclassifyingIncome, setReclassifyingIncome] = useState(false);
  const [selectedIncomeIds, setSelectedIncomeIds] = useState<Set<string>>(new Set());

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(BLANK_FORM);

  const [splitTx, setSplitTx] = useState<Transaction | null>(null);

  const allCategories = useMemo(() => {
    const extras = (customCats || []).filter((c) => !DEFAULT_EXPENSE_CATEGORIES.includes(c));
    return [...DEFAULT_EXPENSE_CATEGORIES, ...extras];
  }, [customCats]);

  const handleAddCategory = (cat: string) => {
    if (allCategories.includes(cat)) return;
    const next = [...(customCats || []), cat];
    saveCustomCats.mutate(next);
  };

  const monthKey = selectedMonth || getMonthKey(new Date());
  const txs = useMemo(
    () => filterTransactionsToCalendarMonth(transactions ?? [], monthKey),
    [transactions, monthKey],
  );

  const duplicateGroups = useMemo<DuplicateGroup[]>(
    () => detectLikelyDuplicates(allTransactions || []).map((g) => ({
      id: g.id,
      transactions: g.transactions,
      suggestedDeleteIds: new Set(g.suggestedDeleteIds),
    })),
    [allTransactions],
  );

  const likelyIncomeCandidates = useMemo<IncomeReclassCandidate[]>(() => {
    const suggest = (name: string): IncomeCategory => {
      const n = name.toLowerCase();
      if (n.includes("payroll") || n.includes("direct dep") || n.includes("salary") || n.includes("adp")) return "Payroll";
      if (n.includes("cash app") || n.includes("venmo") || n.includes("zelle")) return "Cash Transfer";
      if (n.includes("uber") || n.includes("doordash") || n.includes("instacart")) return "Gig Work";
      if (n.includes("shop") || n.includes("stripe") || n.includes("square")) return "Side Business";
      return "Other Income";
    };
    const depositHints = [
      "deposit", "direct dep", "payroll", "salary", "ach credit", "credit from",
      "refund", "reimbursement", "zelle", "venmo", "cash app",
    ];
    return txs
      .filter((tx) => (!tx.type || tx.type === "expense"))
      .filter((tx) => !tx.splitFrom && tx.status === "cleared")
      .filter((tx) => Math.abs(tx.amount) >= 100)
      .filter((tx) => {
        const n = tx.name.toLowerCase();
        return depositHints.some((hint) => n.includes(hint));
      })
      .map((tx) => ({ tx, suggestedIncomeCategory: suggest(tx.name) }));
  }, [txs]);

  const monthOptions = useMemo(
    () => buildMonthOptions(months?.map((m) => m.month) ?? [], monthKey),
    [months, monthKey]
  );

  const txCategories = useMemo(() => {
    const cats = new Set<string>(txs.map((t) => t.category));
    return [...allCategories.filter((c) => cats.has(c)), ...Array.from(cats).filter((c) => !allCategories.includes(c))];
  }, [txs, allCategories]);

  const filtered = txs.filter((t) => {
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const listFiltered = filterCat !== "all" || !!search.trim();

  /** Full month totals after phase-2 audit filters. */
  const { spending: expenseTotalMonth, income: incomeTotalMonth } = computeAuditedMonthTotals(txs);

  const handleSave = () => {
    if (!formData.name || !formData.amount) return;
    const amount = Math.abs(parseFloat(formData.amount));
    const duplicateCandidates = findPotentialDuplicates(
      { name: formData.name, amount, date: formData.date, category: formData.category },
      txs,
    ).filter((tx) => tx.id !== editingId);
    if (duplicateCandidates.length > 0) {
      toast({
        variant: "destructive",
        title: "Possible duplicate transaction",
        description: `Found ${duplicateCandidates.length} similar transaction${duplicateCandidates.length !== 1 ? "s" : ""} within 5 days. Edit the existing row to avoid double counting.`,
      });
      return;
    }
    const payload: any = {
      date: formData.date,
      name: formData.name,
      amount,
      category: formData.category,
      status: formData.status,
      month: monthKey,
      source: formData.status === "pending" ? "pending_transaction" : "posted_transaction",
    };
    if (formData.note.trim()) payload.note = formData.note.trim();
    if (editingId) {
      updateTx.mutate({ id: editingId, data: payload });
    } else {
      addTx.mutate(payload);
    }
    setIsDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData(BLANK_FORM);
    setEditingId(null);
  };

  const openEdit = (tx: Transaction) => {
    setFormData({
      date: tx.date,
      name: tx.name,
      amount: tx.amount.toString(),
      category: tx.category,
      status: tx.status,
      note: tx.note ?? "",
    });
    setEditingId(tx.id);
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    exportToCSV(txs.map((t) => ({
      date: t.date, name: t.name, amount: t.amount, category: t.category,
    })), `ledger-${monthKey}.csv`);
  };

  const handleRemoveDuplicates = async () => {
    setRemovingDups(true);
    const toDelete = Array.from(selectedDuplicateIds)
      .map((id) => (allTransactions || []).find((tx) => tx.id === id))
      .filter((tx): tx is Transaction => !!tx);
    for (const tx of toDelete) {
      await deleteTx.mutateAsync({ id: tx.id, month: tx.month });
    }
    setRemovingDups(false);
    setDupDialogOpen(false);
    setSelectedDuplicateIds(new Set());
    toast({ description: `Removed ${toDelete.length} selected duplicate transaction${toDelete.length !== 1 ? "s" : ""}.` });
  };

  const handleSplit = async (splits: { name: string; amount: number; category: string }[]) => {
    if (!splitTx) return;
    for (const s of splits) {
      await addTx.mutateAsync({
        date: splitTx.date,
        name: s.name,
        amount: s.amount,
        category: s.category,
        status: splitTx.status,
        month: splitTx.month,
        type: splitTx.type,
        splitFrom: splitTx.id,
        source: splitTx.source ?? (splitTx.status === "pending" ? "pending_transaction" : "posted_transaction"),
      } as any);
    }
    await deleteTx.mutateAsync({ id: splitTx.id, month: splitTx.month });
    setSplitTx(null);
  };

  const handleReclassifyIncome = async () => {
    const selected = likelyIncomeCandidates.filter((c) => selectedIncomeIds.has(c.tx.id));
    if (!selected.length) return;
    setReclassifyingIncome(true);
    try {
      for (const item of selected) {
        await updateTx.mutateAsync({
          id: item.tx.id,
          data: {
            type: "income",
            incomeCategory: item.suggestedIncomeCategory,
            source: "posted_transaction",
          } as any,
        });
      }
      toast({
        description: `Reclassified ${selected.length} transaction${selected.length !== 1 ? "s" : ""} as income deposits.`,
      });
      setIncomeReclassOpen(false);
      setSelectedIncomeIds(new Set());
    } finally {
      setReclassifyingIncome(false);
    }
  };

  return (
    <div className="relative space-y-5">
      {isLoading && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-2 rounded-md border border-cyan-500/25 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary backdrop-blur-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading…
        </div>
      )}
      <CyberHero />
      <div className="flex flex-col gap-3 rounded-xl border border-cyan-500/25 bg-card/40 p-3 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <CalendarDays className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Month for this ledger</p>
            <p className="truncate font-display text-sm font-semibold tracking-wide text-foreground">
              {formatMonthLabel(monthKey)}
            </p>
          </div>
        </div>
        <Select value={monthKey} onValueChange={onMonthChange}>
          <SelectTrigger className="w-full font-mono text-sm sm:w-[min(100%,240px)] border-cyan-500/25 bg-input/70 backdrop-blur-sm">
            <SelectValue placeholder="Select month" />
          </SelectTrigger>
          <SelectContent className="border-cyan-500/20 bg-popover/95 backdrop-blur-xl max-h-[min(70vh,320px)]">
            {monthOptions.map((key) => (
              <SelectItem key={key} value={key} className="font-mono text-xs">
                {formatMonthLabel(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col sm:flex-row justify-between gap-4 surface-tech p-4 sm:p-5 rounded-xl">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-primary/70" />
            <Input
              placeholder="Search..."
              className="pl-8 font-mono text-sm bg-input/70 border-cyan-500/25 backdrop-blur-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-[140px] font-mono text-sm bg-input/70 border-cyan-500/25">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {txCategories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-end">
          <div className="flex flex-col items-end gap-1 sm:items-end">
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Income (month)</p>
                <p className="font-mono font-bold text-emerald-400">+${incomeTotalMonth.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Expenses (month)</p>
                <p className="font-mono font-bold text-red-400">${expenseTotalMonth.toFixed(2)}</p>
              </div>
            </div>
            {listFiltered && (
              <p className="max-w-[280px] text-right font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                List filtered · showing {filtered.length} of {txs.length} in {formatMonthLabel(monthKey)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
          {likelyIncomeCandidates.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedIncomeIds(new Set(likelyIncomeCandidates.map((c) => c.tx.id)));
                setIncomeReclassOpen(true);
              }}
              className="font-mono text-xs uppercase tracking-wider border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
            >
              <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
              Reclassify Deposits ({likelyIncomeCandidates.length})
            </Button>
          )}
          {duplicateGroups.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const defaults = new Set<string>();
                duplicateGroups.forEach((g) => g.suggestedDeleteIds.forEach((id) => defaults.add(id)));
                setSelectedDuplicateIds(defaults);
                setDupDialogOpen(true);
              }}
              className="font-mono text-xs uppercase tracking-wider border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              AI Scan {duplicateGroups.length}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={handleExport}>
            <Download className="h-4 w-4" />
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="font-mono text-sm uppercase tracking-wider shadow-[0_0_20px_-6px_hsl(187_100%_50%_/_.45)]">
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-popover/95 border-cyan-500/25 backdrop-blur-xl">
              <DialogHeader>
                <DialogTitle className="font-mono uppercase text-primary tracking-wider">
                  {editingId ? "Edit Transaction" : "New Transaction"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Date</Label>
                  <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="font-mono bg-input/80 border-cyan-500/20" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Name</Label>
                  <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="font-mono bg-input/80 border-cyan-500/20" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Amount</Label>
                  <Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="font-mono bg-input/80 border-cyan-500/20" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Category</Label>
                  <CategorySelect
                    value={formData.category}
                    onChange={(v) => setFormData({ ...formData, category: v })}
                    allCategories={allCategories}
                    onAdd={handleAddCategory}
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Status</Label>
                  <Select value={formData.status} onValueChange={(v: any) => setFormData({ ...formData, status: v })}>
                    <SelectTrigger className="font-mono bg-input/80 border-cyan-500/20"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cleared">Cleared</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Note / Label (optional)</Label>
                  <Input
                    value={formData.note}
                    onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                    placeholder="e.g. groceries run, gift for mom..."
                    className="font-mono bg-input/80 border-cyan-500/20"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="font-mono uppercase text-xs">Cancel</Button>
                <Button onClick={handleSave} className="font-mono uppercase text-xs" disabled={addTx.isPending || updateTx.isPending}>
                  {(addTx.isPending || updateTx.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>
      </div>

      <Card className="surface-tech overflow-hidden">
        <div className="relative overflow-x-auto">
          {isLoading && (
            <div className="absolute inset-0 z-[1] flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
              <Loader2 className="h-10 w-10 animate-spin text-primary" aria-label="Loading transactions" />
            </div>
          )}
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-black/25 border-b border-cyan-500/15 font-mono tracking-wider">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center font-mono">
                    <p className="text-muted-foreground">No transactions for this month.</p>
                    {months && months.length > 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Data available in:{" "}
                        {[...(months ?? [])]
                          .sort((a, b) => b.month.localeCompare(a.month))
                          .map((m) => m.month)
                          .join(", ")}
                        {" "}— use the month picker above.
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => (
                  <tr key={tx.id} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">{tx.date}</td>
                    <td className="px-4 py-3 font-medium max-w-[200px]">
                      <p className="truncate">{tx.name}</p>
                      {tx.note && <p className="text-[10px] font-mono text-muted-foreground/70 truncate mt-0.5">{tx.note}</p>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase border ${getCategoryColor(tx.category)}`}>
                        {tx.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-right whitespace-nowrap">${tx.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className={`inline-block w-2 h-2 rounded-full ${tx.status === "cleared" ? "bg-green-500" : tx.status === "pending" ? "bg-yellow-500" : "bg-red-500"}`} title={tx.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary"
                        title="Split transaction"
                        onClick={() => setSplitTx(tx)}
                      >
                        <Scissors className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(tx)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteTx.mutate({ id: tx.id, month: tx.month })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Split Dialog */}
      <Dialog open={!!splitTx} onOpenChange={(open) => { if (!open) setSplitTx(null); }}>
        {splitTx && (
          <SplitDialog
            tx={splitTx}
            allCategories={allCategories}
            onAddCategory={handleAddCategory}
            onConfirm={handleSplit}
            onClose={() => setSplitTx(null)}
          />
        )}
      </Dialog>

      {/* Duplicate Finder Dialog */}
      <Dialog open={dupDialogOpen} onOpenChange={setDupDialogOpen}>
        <DialogContent className="sm:max-w-[560px] bg-popover/95 border-cyan-500/25 backdrop-blur-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-yellow-400 tracking-wider text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Duplicate Transactions
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs font-mono text-muted-foreground">
            Found <span className="text-yellow-400">{duplicateGroups.length}</span> possible duplicate group{duplicateGroups.length !== 1 ? "s" : ""}.
            AI pre-selects likely duplicates; adjust selections before deleting.
          </p>
          <div className="space-y-3 py-2">
            {duplicateGroups.map((group, i) => (
              <div key={i} className="border border-yellow-500/20 rounded-md p-3 bg-yellow-500/5">
                <p className="font-mono text-xs text-yellow-400 uppercase tracking-wider mb-2">{group.transactions.length} copies</p>
                <div className="space-y-1">
                  {group.transactions.map((tx, j) => {
                    const checked = selectedDuplicateIds.has(tx.id);
                    return (
                    <div key={tx.id} className={`flex items-center justify-between text-xs font-mono ${j === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selectedDuplicateIds);
                            if (e.target.checked) next.add(tx.id);
                            else next.delete(tx.id);
                            setSelectedDuplicateIds(next);
                          }}
                        />
                        <span>{tx.date} — {tx.name.slice(0, 35)}</span>
                      </label>
                      <span className="ml-2 flex-shrink-0">${Math.abs(tx.amount).toFixed(2)} ({tx.month}) {j === 0 ? "baseline" : "candidate"}</span>
                    </div>
                  )})}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => setDupDialogOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button variant="warning" onClick={handleRemoveDuplicates} disabled={removingDups || selectedDuplicateIds.size === 0} className="font-mono text-xs uppercase">
              {removingDups ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Remove Selected ({selectedDuplicateIds.size})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Income Reclassify Dialog */}
      <Dialog open={incomeReclassOpen} onOpenChange={setIncomeReclassOpen}>
        <DialogContent className="sm:max-w-[620px] bg-popover/95 border-cyan-500/25 backdrop-blur-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-emerald-300 tracking-wider text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Likely Income Deposits
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs font-mono text-muted-foreground">
            Select transactions to convert from expense to income. Suggested category is shown for each row.
          </p>
          <div className="space-y-2 py-2">
            {likelyIncomeCandidates.map((item) => {
              const checked = selectedIncomeIds.has(item.tx.id);
              return (
                <div key={item.tx.id} className="flex items-center justify-between gap-3 border border-emerald-500/20 rounded p-2 text-xs font-mono">
                  <label className="flex items-center gap-2 cursor-pointer min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(selectedIncomeIds);
                        if (e.target.checked) next.add(item.tx.id);
                        else next.delete(item.tx.id);
                        setSelectedIncomeIds(next);
                      }}
                    />
                    <span className="truncate">{item.tx.date} — {item.tx.name}</span>
                  </label>
                  <span className="text-emerald-300 whitespace-nowrap">+${Math.abs(item.tx.amount).toFixed(2)} · {item.suggestedIncomeCategory}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => setIncomeReclassOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button
              onClick={handleReclassifyIncome}
              disabled={reclassifyingIncome || selectedIncomeIds.size === 0}
              variant="success"
              className="font-mono text-xs uppercase"
            >
              {reclassifyingIncome ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingUp className="w-4 h-4 mr-2" />}
              Reclassify Selected ({selectedIncomeIds.size})
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
