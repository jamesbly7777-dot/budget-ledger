import { useState } from "react";
import { useRules, useAddRule, useUpdateRule, useDeleteRule, useReapplyRules } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Plus, Edit2, Trash2, TestTube, RefreshCw } from "lucide-react";
import { Rule, RuleCondition, RuleAction, TransactionCategory } from "@/lib/types";
import { runRulesEngine } from "@/lib/rulesEngine";

export default function RulesPage() {
  const { data: userRules, isLoading } = useRules();
  const addRule = useAddRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const reapply = useReapplyRules();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reapplyResult, setReapplyResult] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    priority: "10",
    isActive: true,
    conditionField: "name" as "name" | "amount",
    conditionOp: "contains" as any,
    conditionVal: "",
    actionType: "set_category" as any,
    actionCategory: "Uncategorized" as TransactionCategory,
  });

  const [testName, setTestName] = useState("");
  const [testAmount, setTestAmount] = useState("");
  const [testResult, setTestResult] = useState<{ category: string; rule: string } | null>(null);

  if (isLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const rules = userRules || [];

  const handleSave = () => {
    if (!formData.name || !formData.conditionVal) return;

    let val: string | number = formData.conditionVal;
    if (formData.conditionField === "amount") {
      val = parseFloat(val);
    }

    const payload: Omit<Rule, "id" | "createdAt" | "updatedAt" | "userId"> = {
      name: formData.name,
      priority: parseInt(formData.priority, 10),
      isActive: formData.isActive,
      condition: {
        field: formData.conditionField,
        operator: formData.conditionOp,
        value: val,
      },
      action: {
        type: formData.actionType,
        category: formData.actionType === "set_category" ? formData.actionCategory : undefined,
      },
    };

    if (editingId) {
      updateRule.mutate({ id: editingId, data: payload as Partial<Rule> });
    } else {
      addRule.mutate(payload as any);
    }
    setIsDialogOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      name: "",
      priority: "10",
      isActive: true,
      conditionField: "name",
      conditionOp: "contains",
      conditionVal: "",
      actionType: "set_category",
      actionCategory: "Uncategorized",
    });
    setEditingId(null);
  };

  const openEdit = (r: Rule) => {
    setFormData({
      name: r.name,
      priority: r.priority.toString(),
      isActive: r.isActive,
      conditionField: r.condition.field as any,
      conditionOp: r.condition.operator as any,
      conditionVal: r.condition.value.toString(),
      actionType: r.action.type as any,
      actionCategory: r.action.category || "Uncategorized",
    });
    setEditingId(r.id);
    setIsDialogOpen(true);
  };

  const handleTest = () => {
    const amt = parseFloat(testAmount) || 0;
    const items = [{ date: new Date().toISOString(), name: testName, amount: amt }];
    const result = runRulesEngine(items, rules, []);
    if (result.length > 0) {
      setTestResult({
        category: result[0].resolvedCategory,
        rule: result[0].ruleApplied || "None (Uncategorized)",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4 surface-tech p-5 rounded-xl">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-[0.12em] uppercase text-glow-cyan">Rules Engine</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">Transaction categorization logic</p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="text-right">
            {reapplyResult !== null && (
              <p className="text-xs font-mono text-green-400">{reapplyResult} transaction{reapplyResult !== 1 ? "s" : ""} updated</p>
            )}
          </div>
          <Button
            variant="outline"
            className="font-mono text-xs uppercase tracking-wider"
            disabled={reapply.isPending}
            onClick={() => {
              setReapplyResult(null);
              reapply.mutate(
                { rules: rules },
                { onSuccess: (n) => setReapplyResult(n) }
              );
            }}
          >
            {reapply.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Re-apply Rules
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if(!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="font-mono text-sm uppercase tracking-wider">
              <Plus className="h-4 w-4 mr-2" /> Add Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-popover/95 border-cyan-500/25 backdrop-blur-xl">
            <DialogHeader>
              <DialogTitle className="font-mono uppercase text-primary tracking-wider">
                {editingId ? "Edit Rule" : "New Rule"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Rule Name</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="font-mono bg-input border-border" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Priority</Label>
                  <Input type="number" value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value})} className="font-mono bg-input border-border" />
                </div>
                <div className="flex flex-col justify-end pb-2">
                  <div className="flex items-center space-x-2">
                    <Switch checked={formData.isActive} onCheckedChange={c => setFormData({...formData, isActive: c})} />
                    <Label className="font-mono text-xs uppercase text-muted-foreground">Active</Label>
                  </div>
                </div>
              </div>
              <div className="border border-border/50 p-3 rounded-md space-y-3">
                <Label className="font-mono text-xs uppercase text-primary">Condition</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={formData.conditionField} onValueChange={(v: any) => setFormData({...formData, conditionField: v})}>
                    <SelectTrigger className="font-mono text-xs bg-input border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="amount">Amount</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={formData.conditionOp} onValueChange={(v: any) => setFormData({...formData, conditionOp: v})}>
                    <SelectTrigger className="font-mono text-xs bg-input border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {formData.conditionField === "name" ? (
                        <>
                          <SelectItem value="contains">Contains</SelectItem>
                          <SelectItem value="equals">Equals</SelectItem>
                          <SelectItem value="not_contains">Not Contains</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="gt">&gt;</SelectItem>
                          <SelectItem value="lt">&lt;</SelectItem>
                          <SelectItem value="gte">&ge;</SelectItem>
                          <SelectItem value="lte">&le;</SelectItem>
                          <SelectItem value="equals">=</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Input placeholder="Value" value={formData.conditionVal} onChange={e => setFormData({...formData, conditionVal: e.target.value})} className="font-mono bg-input border-border mt-2" />
              </div>
              <div className="border border-border/50 p-3 rounded-md space-y-3">
                <Label className="font-mono text-xs uppercase text-primary">Action</Label>
                <Select value={formData.actionType} onValueChange={(v: any) => setFormData({...formData, actionType: v})}>
                  <SelectTrigger className="font-mono text-xs bg-input border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="set_category">Set Category</SelectItem>
                    <SelectItem value="skip">Skip / Ignore</SelectItem>
                    <SelectItem value="flag_review">Flag for Review</SelectItem>
                  </SelectContent>
                </Select>
                {formData.actionType === "set_category" && (
                  <Select value={formData.actionCategory} onValueChange={(v: any) => setFormData({...formData, actionCategory: v})}>
                    <SelectTrigger className="font-mono text-xs bg-input border-border mt-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Bills">Bills</SelectItem>
                      <SelectItem value="Fuel">Fuel</SelectItem>
                      <SelectItem value="Necessary">Necessary</SelectItem>
                      <SelectItem value="Medical">Medical</SelectItem>
                      <SelectItem value="Shopping">Shopping</SelectItem>
                      <SelectItem value="Transfers">Transfers</SelectItem>
                      <SelectItem value="Personal">Personal</SelectItem>
                      <SelectItem value="Waste">Waste</SelectItem>
                      <SelectItem value="Work">Work (AI / tools)</SelectItem>
                      <SelectItem value="Uncategorized">Uncategorized</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="font-mono uppercase text-xs">Cancel</Button>
              <Button onClick={handleSave} className="font-mono uppercase text-xs" disabled={addRule.isPending || updateRule.isPending}>
                {(addRule.isPending || updateRule.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="surface-tech">
          <CardHeader>
            <CardTitle className="font-mono uppercase tracking-wider text-sm text-primary">Your Rules</CardTitle>
          </CardHeader>
          <CardContent>
            {rules.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground font-mono text-sm border border-dashed border-border/50 rounded-md">
                No custom rules defined.
              </div>
            ) : (
              <div className="space-y-3">
                {rules.map(rule => (
                  <div key={rule.id} className={`p-3 rounded-md border transition-colors ${rule.isActive ? 'bg-secondary/30 border-border' : 'bg-transparent border-border/50 opacity-50'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold font-mono text-sm">{rule.name}</h4>
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                          IF {rule.condition.field} {rule.condition.operator} "{rule.condition.value}"
                        </p>
                        <p className="text-xs text-primary font-mono mt-1 uppercase tracking-wider">
                          THEN {rule.action.type} {rule.action.category ? `→ ${rule.action.category}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch checked={rule.isActive} onCheckedChange={c => updateRule.mutate({ id: rule.id, data: { isActive: c } })} className="mr-2" />
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => openEdit(rule)}>
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => deleteRule.mutate(rule.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="surface-tech">
            <CardHeader>
              <CardTitle className="font-mono uppercase tracking-wider text-sm text-primary flex items-center">
                <TestTube className="w-4 h-4 mr-2" /> Rules Sandbox
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Test Name</Label>
                  <Input value={testName} onChange={e => setTestName(e.target.value)} className="font-mono bg-input border-border" placeholder="e.g. McDonald's" />
                </div>
                <div className="grid gap-2">
                  <Label className="font-mono text-xs uppercase text-muted-foreground">Test Amount</Label>
                  <Input type="number" value={testAmount} onChange={e => setTestAmount(e.target.value)} className="font-mono bg-input border-border" placeholder="12.50" />
                </div>
                <Button onClick={handleTest} className="w-full font-mono uppercase tracking-wider text-xs">Run Test</Button>
                
                {testResult && (
                  <div className="mt-4 p-3 bg-secondary/50 rounded-md border border-border">
                    <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">Result</p>
                    <p className="font-mono font-bold text-sm">Category: <span className="text-primary">{testResult.category}</span></p>
                    <p className="font-mono text-xs mt-1 text-muted-foreground">Matched: {testResult.rule}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="surface-tech">
            <CardHeader>
              <CardTitle className="font-mono uppercase tracking-wider text-sm text-primary">Built-in Core Rules</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 font-mono text-xs">
                <div className="p-2 border-b border-border/50 flex justify-between">
                  <span className="text-orange-400 font-bold">FUEL</span>
                  <span className="text-muted-foreground text-right w-2/3">Gas &ge;$15. Else Waste.</span>
                </div>
                <div className="p-2 border-b border-border/50 flex justify-between">
                  <span className="text-cyan-400 font-bold">TRANSFERS</span>
                  <span className="text-muted-foreground text-right w-2/3">Zelle, Venmo, Paypal</span>
                </div>
                <div className="p-2 border-b border-border/50 flex justify-between">
                  <span className="text-purple-400 font-bold">MEDICAL</span>
                  <span className="text-muted-foreground text-right w-2/3">Hospital, pharmacy, clinic</span>
                </div>
                <div className="p-2 border-b border-border/50 flex justify-between">
                  <span className="text-blue-400 font-bold">BILLS</span>
                  <span className="text-muted-foreground text-right w-2/3">Rent, insurance, utility</span>
                </div>
                <div className="p-2 border-b border-border/50 flex justify-between">
                  <span className="text-green-400 font-bold">NECESSARY</span>
                  <span className="text-muted-foreground text-right w-2/3">Grocery, household</span>
                </div>
                <div className="p-2 border-b border-border/50 flex justify-between">
                  <span className="text-red-400 font-bold">WASTE</span>
                  <span className="text-muted-foreground text-right w-2/3">Fast food, vending</span>
                </div>
                <div className="p-2 flex justify-between">
                  <span className="text-gray-400 font-bold">SKIP</span>
                  <span className="text-muted-foreground text-right w-2/3">IRS, Verizon</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
