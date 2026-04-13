import { useState, useMemo } from "react";
import {
  useTransactions, useAddTransaction, useUpdateTransaction,
  useDeleteTransaction, useMonths, useCustomCategories, useSaveCustomCategories,
} from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Plus, Search, Download, Edit2, Trash2, ScanSearch,
  AlertTriangle, Scissors, X, PlusCircle,
} from "lucide-react";
import { CategorySelect } from "@/components/ui/CategorySelect";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TransactionStatus, Transaction, DEFAULT_EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/types";
import { exportToCSV } from "@/lib/csvParser";

const BASE_CATEGORY_COLORS: Record<string, string> = {
  Bills: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Fuel: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  Necessary: "bg-green-500/20 text-green-400 border-green-500/30",
  Medical: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Shopping: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  Transfers: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  Personal: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  Waste: "bg-red-500/20 text-red-400 border-red-500/30",
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
  type: "expense" as "expense" | "income",
  incomeCategory: "Other Income" as string,
};

// ─── Split Dialog ─────────────────────────────────────────────────────────────
interface SplitRow {
  id: number;
  label: string;
  amount: string;
  category: string;
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
    <DialogContent className="sm:max-w-[520px] bg-card border-border">
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
export default function LedgerPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: transactions, isLoading } = useTransactions(selectedMonth);
  const { data: allTransactions } = useTransactions();
  const { data: months } = useMonths();
  const { data: customCats = [] } = useCustomCategories();
  const saveCustomCats = useSaveCustomCategories();
  const addTx = useAddTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [dupDialogOpen, setDupDialogOpen] = useState(false);
  const [removingDups, setRemovingDups] = useState(false);

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

  const duplicateGroups = useMemo(() => {
    const all = allTransactions || [];
    const groups: Record<string, Transaction[]> = {};
    for (const tx of all) {
      const key = `${tx.date}|${tx.name.toLowerCase().trim()}|${Math.abs(tx.amount ?? 0).toFixed(2)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    }
    return Object.values(groups).filter((g) => g.length > 1);
  }, [allTransactions]);

  // Must be before any early return — hooks cannot be called conditionally
  const txCategories = useMemo(() => {
    const cats = new Set<string>((transactions || []).map((t) => t.category));
    return [...allCategories.filter((c) => cats.has(c)), ...Array.from(cats).filter((c) => !allCategories.includes(c))];
  }, [transactions, allCategories]);

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const txs = transactions || [];

  const filtered = txs.filter((t) => {
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const expenseTotal = filtered.filter((t) => !t.type || t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const incomeTotal = filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);

  const handleSave = () => {
    if (!formData.name || !formData.amount) return;
    const payload: any = {
      date: formData.date,
      name: formData.name,
      amount: Math.abs(parseFloat(formData.amount)),
      category: formData.type === "income" ? "Income" : formData.category,
      status: formData.status,
      month: selectedMonth,
      type: formData.type,
    };
    if (formData.note.trim()) payload.note = formData.note.trim();
    if (formData.type === "income") {
      payload.incomeCategory = formData.incomeCategory || "Other Income";
    }
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
      type: tx.type ?? "expense",
      incomeCategory: tx.incomeCategory ?? "Other Income",
    });
    setEditingId(tx.id);
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    exportToCSV(txs.map((t) => ({
      date: t.date, name: t.name, amount: t.amount, category: t.category,
    })), `ledger-${selectedMonth}.csv`);
  };

  const handleRemoveDuplicates = async () => {
    setRemovingDups(true);
    for (const group of duplicateGroups) {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const toDelete = sorted.slice(1);
      for (const tx of toDelete) { await deleteTx.mutateAsync({ id: tx.id, month: tx.month }); }
    }
    setRemovingDups(false);
    setDupDialogOpen(false);
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
      } as any);
    }
    await deleteTx.mutateAsync({ id: splitTx.id, month: splitTx.month });
    setSplitTx(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="pl-8 font-mono text-sm bg-card border-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-[140px] font-mono text-sm bg-card border-border">
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
          <div className="flex gap-4">
            {incomeTotal > 0 && (
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Income</p>
                <p className="font-mono font-bold text-emerald-400">+${incomeTotal.toFixed(2)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Expenses</p>
              <p className="font-mono font-bold text-red-400">${expenseTotal.toFixed(2)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
          {duplicateGroups.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setDupDialogOpen(true)} className="font-mono text-xs uppercase tracking-wider border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10">
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              {duplicateGroups.length} Dup{duplicateGroups.length !== 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={handleExport}>
            <Download className="h-4 w-4" />
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="font-mono text-sm uppercase tracking-wider font-bold">
                <Plus className="h-4 w-4 mr-2" /> Add Transaction
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-mono uppercase text-primary tracking-wider">
                  {editingId ? "Edit Transaction" : "New Transaction"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                {/* Expense / Income toggle */}
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Type</Label>
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-md" style={{ background: "rgba(56,155,255,0.06)", border: "1px solid rgba(56,155,255,0.15)" }}>
                    {(["expense", "income"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFormData({ ...formData, type: t })}
                        className={`py-1.5 rounded text-xs font-mono uppercase tracking-wider transition-all ${formData.type === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        style={formData.type === t ? { boxShadow: "0 0 12px rgba(56,155,255,0.4)" } : {}}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Date</Label>
                  <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="font-mono bg-input border-border" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Description</Label>
                  <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="font-mono bg-input border-border" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Amount</Label>
                  <Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="font-mono bg-input border-border" />
                </div>
                {formData.type === "income" ? (
                  <div className="grid gap-2">
                    <Label className="font-mono text-xs uppercase text-muted-foreground">Income Source</Label>
                    <Select value={formData.incomeCategory} onValueChange={(v) => setFormData({ ...formData, incomeCategory: v })}>
                      <SelectTrigger className="font-mono bg-input border-border"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INCOME_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c} className="font-mono">{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Category</Label>
                  <CategorySelect
                    value={formData.category}
                    onChange={(v) => setFormData({ ...formData, category: v })}
                    allCategories={allCategories}
                    onAdd={handleAddCategory}
                  />
                </div>
                )}
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Status</Label>
                  <Select value={formData.status} onValueChange={(v: any) => setFormData({ ...formData, status: v })}>
                    <SelectTrigger className="font-mono bg-input border-border"><SelectValue /></SelectTrigger>
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
                    className="font-mono bg-input border-border"
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

      <Card className="border-border">
        {/* ── Mobile card list (phones) ── */}
        <div className="md:hidden">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono">
              <p className="text-muted-foreground">No transactions for this month.</p>
              {months && months.length > 0 && (
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Data available in: {months.sort((a, b) => b.month.localeCompare(a.month)).map((m) => m.month).join(", ")} — use the month picker above.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {filtered.map((tx) => {
                const isIncome = tx.type === "income";
                return (
                  <div key={tx.id} className="px-4 py-3 hover:bg-muted/10 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate" title={tx.name}>{tx.name}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{tx.date}</span>
                          <Badge variant="outline" className={`font-mono text-[10px] uppercase border ${getCategoryColor(tx.category)}`}>
                            {tx.category}
                          </Badge>
                          {tx.status !== "cleared" && (
                            <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${tx.status === "pending" ? "badge-pending" : "badge-review"}`}>{tx.status}</span>
                          )}
                        </div>
                        {tx.note && <p className="text-[10px] font-mono text-muted-foreground/70 truncate mt-0.5">{tx.note}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className={`font-mono font-bold text-base ${isIncome ? "text-emerald-400" : ""}`}>
                          {isIncome ? "+" : ""}${tx.amount.toFixed(2)}
                        </p>
                        <div className="flex items-center justify-end gap-1 mt-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" title="Split" onClick={() => setSplitTx(tx)}>
                            <Scissors className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => openEdit(tx)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteTx.mutate({ id: tx.id, month: tx.month })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Desktop table ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-card border-b border-border font-mono tracking-wider">
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
                        {months.sort((a, b) => b.month.localeCompare(a.month)).map((m) => m.month).join(", ")}
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
                      <p className="truncate" title={tx.name}>{tx.name}</p>
                      {tx.note && <p className="text-[10px] font-mono text-muted-foreground/70 truncate mt-0.5">{tx.note}</p>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase border ${getCategoryColor(tx.category)}`}>
                        {tx.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-right whitespace-nowrap">${tx.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {tx.status !== "cleared" && (
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${tx.status === "pending" ? "badge-pending" : "badge-review"}`}>{tx.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" title="Split transaction" onClick={() => setSplitTx(tx)}>
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
        <DialogContent className="sm:max-w-[560px] bg-card border-border max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-yellow-400 tracking-wider text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Duplicate Transactions
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs font-mono text-muted-foreground">
            Found <span className="text-yellow-400">{duplicateGroups.length}</span> duplicate group{duplicateGroups.length !== 1 ? "s" : ""} across all months.
            Removing keeps the earliest copy and deletes the rest.
          </p>
          <div className="space-y-3 py-2">
            {duplicateGroups.map((group, i) => (
              <div key={i} className="border border-yellow-500/20 rounded-md p-3 bg-yellow-500/5">
                <p className="font-mono text-xs text-yellow-400 uppercase tracking-wider mb-2">{group.length} copies</p>
                <div className="space-y-1">
                  {group.map((tx, j) => (
                    <div key={tx.id} className={`flex items-center justify-between text-xs font-mono ${j === 0 ? "text-foreground" : "text-muted-foreground line-through"}`}>
                      <span>{tx.date} — {tx.name.slice(0, 35)}</span>
                      <span className="ml-2 flex-shrink-0">${Math.abs(tx.amount).toFixed(2)} ({tx.month}) {j === 0 ? "✓ keep" : "✗ remove"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => setDupDialogOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button onClick={handleRemoveDuplicates} disabled={removingDups} className="font-mono text-xs uppercase bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 hover:bg-yellow-500/30">
              {removingDups ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Remove Duplicates
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
