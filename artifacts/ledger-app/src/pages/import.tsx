import { useState, useRef } from "react";
import { useTransactions, useRules, useBulkAddTransactions } from "@/hooks/use-finance";
import { parseCSV, ParsedRow } from "@/lib/csvParser";
import { runRulesEngine } from "@/lib/rulesEngine";
import { ImportPreviewItem } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, UploadCloud, AlertTriangle, Check, FileSpreadsheet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";

export default function ImportPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: existingTxs } = useTransactions(selectedMonth);
  const { data: userRules } = useRules();
  const bulkAdd = useBulkAddTransactions();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv")) {
      toast({ variant: "destructive", title: "Invalid file", description: "Please upload a CSV file." });
      return;
    }

    setParsing(true);
    try {
      const rows = await parseCSV(file);
      const processed = runRulesEngine(rows, userRules || [], existingTxs || []);
      setPreviewItems(processed);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Parse Error", description: err.message });
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateItemAction = (id: string, action: "save" | "skip" | "review") => {
    setPreviewItems(items => items.map(it => it.id === id ? { ...it, action } : it));
  };

  const updateItemCategory = (id: string, category: any) => {
    setPreviewItems(items => items.map(it => it.id === id ? { ...it, resolvedCategory: category } : it));
  };

  const handleConfirm = () => {
    const toSave = previewItems.filter(it => it.action === "save");
    if (toSave.length === 0) {
      toast({ description: "No transactions marked for save." });
      return;
    }

    const payload = toSave.map(it => ({
      date: it.date,
      name: it.name,
      amount: it.amount,
      category: it.resolvedCategory,
      status: it.status,
      month: selectedMonth,
      isDuplicate: it.isDuplicate,
      ruleApplied: it.ruleApplied,
    }));

    bulkAdd.mutate(payload, {
      onSuccess: () => {
        toast({ title: "Import Successful", description: `Saved ${toSave.length} transactions.` });
        setPreviewItems([]);
        setLocation("/ledger");
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Import Failed", description: err.message });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Data Import</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">Target Month: <span className="text-primary">{selectedMonth}</span></p>
        </div>
      </div>

      {!previewItems.length ? (
        <Card className="border-border border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center mb-2">
              <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground font-mono text-center max-w-sm">
              Upload bank CSV exports. The rules engine will automatically categorize transactions and flag duplicates.
            </p>
            <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
            <Button onClick={() => fileInputRef.current?.click()} disabled={parsing} className="font-mono uppercase text-xs tracking-wider">
              {parsing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
              Select CSV File
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-card p-4 rounded-lg border border-border">
            <div className="flex items-center gap-6 text-sm font-mono">
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Total Parsed</span>
                <span className="font-bold text-lg">{previewItems.length}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">To Save</span>
                <span className="font-bold text-lg text-green-400">{previewItems.filter(i => i.action === 'save').length}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Duplicates</span>
                <span className="font-bold text-lg text-red-400">{previewItems.filter(i => i.isDuplicate).length}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPreviewItems([])} className="font-mono text-xs uppercase tracking-wider">Cancel</Button>
              <Button onClick={handleConfirm} disabled={bulkAdd.isPending} className="font-mono text-xs uppercase tracking-wider">
                {bulkAdd.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm Import
              </Button>
            </div>
          </div>

          <Card className="border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-muted-foreground uppercase bg-card border-b border-border font-mono tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Date / Name</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {previewItems.map((item) => (
                    <tr key={item.id} className={`border-b border-border/50 ${item.isDuplicate ? 'bg-red-500/5' : item.status === 'review' ? 'bg-yellow-500/5' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-muted-foreground mb-1">{item.date}</div>
                        <div className="font-medium max-w-[200px] truncate" title={item.name}>{item.name}</div>
                        {item.ruleApplied && <div className="text-[10px] text-primary/70 font-mono mt-1 flex items-center gap-1"><Check className="w-3 h-3"/> {item.ruleApplied}</div>}
                        {item.isDuplicate && <div className="text-[10px] text-destructive font-mono mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Potential Duplicate</div>}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-right">${item.amount.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <Select value={item.resolvedCategory} onValueChange={(v) => updateItemCategory(item.id, v)}>
                          <SelectTrigger className="h-8 font-mono text-[10px] uppercase w-[120px] bg-transparent border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Bills">Bills</SelectItem>
                            <SelectItem value="Fuel">Fuel</SelectItem>
                            <SelectItem value="Necessary">Necessary</SelectItem>
                            <SelectItem value="Medical">Medical</SelectItem>
                            <SelectItem value="Shopping">Shopping</SelectItem>
                            <SelectItem value="Transfers">Transfers</SelectItem>
                            <SelectItem value="Personal">Personal</SelectItem>
                            <SelectItem value="Waste">Waste</SelectItem>
                            <SelectItem value="Uncategorized">Uncategorized</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        <Select value={item.action} onValueChange={(v: any) => updateItemAction(item.id, v)}>
                          <SelectTrigger className={`h-8 font-mono text-[10px] uppercase w-[100px] ${item.action === 'save' ? 'text-green-400 border-green-500/30 bg-green-500/10' : item.action === 'skip' ? 'text-muted-foreground border-border bg-transparent' : 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10'}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="save">Save</SelectItem>
                            <SelectItem value="skip">Skip</SelectItem>
                            <SelectItem value="review">Review</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
