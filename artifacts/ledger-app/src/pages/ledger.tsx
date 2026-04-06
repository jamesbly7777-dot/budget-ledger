import { useState, useMemo } from "react";
import { useTransactions, useAddTransaction, useUpdateTransaction, useDeleteTransaction, useMonths } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Search, Download, Edit2, Trash2, ScanSearch, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TransactionCategory, TransactionStatus, Transaction } from "@/lib/types";
import { exportToCSV } from "@/lib/csvParser";

const CATEGORY_COLORS: Record<string, string> = {
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

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  cleared: "bg-green-500/20 text-green-400",
  review: "bg-red-500/20 text-red-400",
};

export default function LedgerPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: transactions, isLoading } = useTransactions(selectedMonth);
  const { data: allTransactions } = useTransactions(); // all months — used for duplicate scan
  const { data: months } = useMonths();
  const addTx = useAddTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");
  const [dupDialogOpen, setDupDialogOpen] = useState(false);
  const [removingDups, setRemovingDups] = useState(false);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Find duplicate groups across ALL months (same date + name + amount)
  const duplicateGroups = useMemo(() => {
    const all = allTransactions || [];
    const groups: Record<string, Transaction[]> = {};
    for (const tx of all) {
      const key = `${tx.date}|${tx.name.toLowerCase().trim()}|${Math.abs(tx.amount).toFixed(2)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    }
    return Object.values(groups).filter((g) => g.length > 1);
  }, [allTransactions]);
  
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    name: "",
    amount: "",
    category: "Uncategorized" as TransactionCategory,
    status: "cleared" as TransactionStatus,
  });

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const txs = transactions || [];
  
  const filtered = txs.filter(t => {
    if (filterCat !== "all" && t.category !== filterCat) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const total = filtered.reduce((s, t) => s + t.amount, 0);

  const handleSave = () => {
    if (!formData.name || !formData.amount) return;
    
    const payload = {
      date: formData.date,
      name: formData.name,
      amount: Math.abs(parseFloat(formData.amount)),
      category: formData.category,
      status: formData.status,
      month: selectedMonth,
    };

    if (editingId) {
      updateTx.mutate({ id: editingId, data: payload });
    } else {
      addTx.mutate(payload);
    }
    setIsDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split("T")[0],
      name: "",
      amount: "",
      category: "Uncategorized",
      status: "cleared",
    });
    setEditingId(null);
  };

  const openEdit = (tx: any) => {
    setFormData({
      date: tx.date,
      name: tx.name,
      amount: tx.amount.toString(),
      category: tx.category,
      status: tx.status,
    });
    setEditingId(tx.id);
    setIsDialogOpen(true);
  };

  const handleExport = () => {
    exportToCSV(txs.map(t => ({
      date: t.date,
      name: t.name,
      amount: t.amount,
      category: t.category
    })), `ledger-${selectedMonth}.csv`);
  };

  const handleRemoveDuplicates = async () => {
    setRemovingDups(true);
    // For each duplicate group, keep the first (oldest by date then name) and delete the rest
    for (const group of duplicateGroups) {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const toDelete = sorted.slice(1); // keep [0], delete the rest
      for (const tx of toDelete) {
        await deleteTx.mutateAsync(tx.id);
      }
    }
    setRemovingDups(false);
    setDupDialogOpen(false);
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
              {Object.keys(CATEGORY_COLORS).map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="text-right mr-4">
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">Total</p>
            <p className="font-mono font-bold">${total.toFixed(2)}</p>
          </div>
          {duplicateGroups.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setDupDialogOpen(true)} className="font-mono text-xs uppercase tracking-wider border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10">
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              {duplicateGroups.length} Dup{duplicateGroups.length !== 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={handleExport}>
            <Download className="h-4 w-4" />
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if(!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="font-mono text-sm uppercase tracking-wider">
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-mono uppercase text-primary tracking-wider">
                  {editingId ? "Edit Transaction" : "New Transaction"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Date</Label>
                  <Input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="font-mono bg-input border-border" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Name</Label>
                  <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="font-mono bg-input border-border" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Amount</Label>
                  <Input type="number" step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="font-mono bg-input border-border" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Category</Label>
                  <Select value={formData.category} onValueChange={(v: any) => setFormData({...formData, category: v})}>
                    <SelectTrigger className="font-mono bg-input border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(CATEGORY_COLORS).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Status</Label>
                  <Select value={formData.status} onValueChange={(v: any) => setFormData({...formData, status: v})}>
                    <SelectTrigger className="font-mono bg-input border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cleared">Cleared</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                    </SelectContent>
                  </Select>
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

      <Card className="border-border">
        <div className="overflow-x-auto">
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
                        {months
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
                    <td className="px-4 py-3 font-medium max-w-[200px] truncate">{tx.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase border ${CATEGORY_COLORS[tx.category] || CATEGORY_COLORS["Uncategorized"]}`}>
                        {tx.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-right whitespace-nowrap">${tx.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className={`inline-block w-2 h-2 rounded-full ${tx.status === 'cleared' ? 'bg-green-500' : tx.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'}`} title={tx.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(tx)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteTx.mutate(tx.id)}>
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
