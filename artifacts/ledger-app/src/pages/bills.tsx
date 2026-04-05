import { useState } from "react";
import { useBills, useAddBill, useUpdateBill, useDeleteBill } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Edit2, Trash2, CheckCircle2, Circle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TransactionCategory } from "@/lib/types";

export default function BillsPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: bills, isLoading } = useBills();
  const addBill = useAddBill();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: "",
    amount: "",
    dueDay: "1",
    category: "Bills" as TransactionCategory,
    isRecurring: true,
  });

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const allBills = bills || [];
  // Filter bills for current month or recurring
  const monthlyBills = allBills.filter(b => b.isRecurring || b.month === selectedMonth);

  const handleSave = () => {
    if (!formData.name || !formData.amount) return;
    
    const payload = {
      name: formData.name,
      amount: parseFloat(formData.amount),
      dueDay: parseInt(formData.dueDay),
      category: formData.category,
      isRecurring: formData.isRecurring,
      month: formData.isRecurring ? undefined : selectedMonth,
      isPaid: false,
    };

    if (editingId) {
      updateBill.mutate({ id: editingId, data: payload });
    } else {
      addBill.mutate(payload);
    }
    setIsDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      name: "",
      amount: "",
      dueDay: "1",
      category: "Bills",
      isRecurring: true,
    });
    setEditingId(null);
  };

  const openEdit = (b: any) => {
    setFormData({
      name: b.name,
      amount: b.amount.toString(),
      dueDay: b.dueDay.toString(),
      category: b.category,
      isRecurring: b.isRecurring,
    });
    setEditingId(b.id);
    setIsDialogOpen(true);
  };

  const togglePaid = (id: string, currentStatus: boolean) => {
    updateBill.mutate({ id, data: { isPaid: !currentStatus } });
  };

  const totalAmount = monthlyBills.reduce((sum, b) => sum + b.amount, 0);
  const paidAmount = monthlyBills.filter(b => b.isPaid).reduce((sum, b) => sum + b.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Bills Manager</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            Paid: <span className="text-green-400">${paidAmount.toFixed(2)}</span> / Total: <span className="text-primary">${totalAmount.toFixed(2)}</span>
          </p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if(!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="font-mono text-sm uppercase tracking-wider">
              <Plus className="h-4 w-4 mr-2" /> Add Bill
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-mono uppercase text-primary tracking-wider">
                {editingId ? "Edit Bill" : "New Bill"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Name</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="font-mono bg-input border-border" />
              </div>
              <div className="grid gap-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Expected Amount</Label>
                <Input type="number" step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="font-mono bg-input border-border" />
              </div>
              <div className="grid gap-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Due Day (1-31)</Label>
                <Input type="number" min="1" max="31" value={formData.dueDay} onChange={e => setFormData({...formData, dueDay: e.target.value})} className="font-mono bg-input border-border" />
              </div>
              <div className="flex items-center justify-between">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Recurring Monthly</Label>
                <Switch checked={formData.isRecurring} onCheckedChange={c => setFormData({...formData, isRecurring: c})} />
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {monthlyBills.length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground font-mono">No bills tracked for this month.</div>
        ) : (
          monthlyBills.sort((a,b) => a.dueDay - b.dueDay).map(bill => (
            <Card key={bill.id} className={`border-border transition-colors ${bill.isPaid ? 'bg-card/50 opacity-60' : 'bg-card'}`}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="flex-1">
                  <CardTitle className="font-sans text-base leading-none tracking-tight">{bill.name}</CardTitle>
                  <p className="text-xs text-muted-foreground font-mono mt-1 uppercase tracking-wider">
                    Due: Day {bill.dueDay}
                  </p>
                </div>
                <button 
                  onClick={() => togglePaid(bill.id, bill.isPaid)}
                  className="text-muted-foreground hover:text-primary transition-colors focus:outline-none"
                >
                  {bill.isPaid ? (
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                  ) : (
                    <Circle className="w-6 h-6" />
                  )}
                </button>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="text-2xl font-bold font-mono">${bill.amount.toFixed(2)}</div>
                <div className="flex items-center justify-end gap-2 mt-4">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(bill)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteBill.mutate(bill.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
