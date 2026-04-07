import { useState, useRef, useEffect, useMemo } from "react";
import { useTransactions, useRules, useBulkAddTransactions, useAddBill, useCustomCategories } from "@/hooks/use-finance";
import { parseCSV } from "@/lib/csvParser";
import { runRulesEngine } from "@/lib/rulesEngine";
import { ImportPreviewItem, INCOME_CATEGORIES } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  UploadCloud,
  AlertTriangle,
  Check,
  FileSpreadsheet,
  Camera,
  Sparkles,
  X,
  FileText,
  TrendingUp,
  TrendingDown,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";

type ImportMode = "csv" | "ai";

const EXPENSE_CATEGORIES = [
  "Bills",
  "Fuel",
  "Necessary",
  "Medical",
  "Shopping",
  "Transfers",
  "Personal",
  "Waste",
  "Uncategorized",
];

export default function ImportPage({ selectedMonth, onMonthChange }: { selectedMonth: string; onMonthChange?: (m: string) => void }) {
  // All state must be declared first before any derived values or effects that reference them
  const [mode, setMode] = useState<ImportMode>("csv");
  const [parsing, setParsing] = useState(false);
  const [aiStage, setAiStage] = useState<"idle" | "uploading" | "analyzing" | "done">("idle");
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  const { data: existingTxs } = useTransactions();
  const { data: userRules } = useRules();
  const { data: customCats = [] } = useCustomCategories();
  const bulkAdd = useBulkAddTransactions();
  const addBill = useAddBill();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Limit duplicate detection to the last 90 days so it doesn't slow down as your history grows
  const recentTxsForDupeCheck = useMemo(() => {
    if (!existingTxs) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    return existingTxs.filter((tx) => {
      const d = new Date(tx.date);
      return !isNaN(d.getTime()) && d >= cutoff;
    });
  }, [existingTxs]);

  const allExpenseCategories = [
    ...EXPENSE_CATEGORIES,
    ...(customCats || []).filter((c) => !EXPENSE_CATEGORIES.includes(c)),
  ];

  const PAGE_SIZE = 50;
  // Reset to page 0 whenever the preview item list changes (new file uploaded)
  useEffect(() => { setPreviewPage(0); }, [previewItems.length]);

  const totalPages = Math.ceil(previewItems.length / PAGE_SIZE);
  const visibleItems = previewItems.slice(previewPage * PAGE_SIZE, (previewPage + 1) * PAGE_SIZE);

  const handleCSVChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      toast({ variant: "destructive", title: "Invalid file", description: "Please upload a CSV file." });
      return;
    }
    setParsing(true);
    try {
      const rows = await parseCSV(file);
      // Yield to the browser before running the synchronous rules engine
      // so the UI stays responsive even with large files
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const processed = runRulesEngine(rows, userRules || [], recentTxsForDupeCheck);
      setPreviewItems(processed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Parse failed";
      toast({ variant: "destructive", title: "Parse Error", description: msg });
    } finally {
      setParsing(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const handleAIImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported file",
        description: "Please upload a PDF bank statement or a JPG/PNG/WebP screenshot.",
      });
      return;
    }

    const isPdf = file.type === "application/pdf";
    setPreviewIsPdf(isPdf);
    setPreviewImageUrl(isPdf ? null : URL.createObjectURL(file));
    setAiStage("uploading");

    try {
      const formData = new FormData();
      formData.append("file", file);

      setAiStage("analyzing");
      const response = await fetch("/api/parse-statement", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Server error" }));
        if (errData.code === "PDF_NOT_SUPPORTED") {
          toast({ variant: "destructive", title: "PDF not supported", description: errData.error });
          setAiStage("idle");
          setPreviewImageUrl(null);
          if (aiInputRef.current) aiInputRef.current.value = "";
          return;
        }
        throw new Error(errData.error || `Server error ${response.status}`);
      }

      const data = await response.json();
      const rawTxs = data.transactions as Array<{
        date: string;
        name: string;
        amount: number;
        type?: string;
        incomeSource?: string | null;
        confidence: string;
      }>;

      if (!rawTxs || rawTxs.length === 0) {
        toast({ title: "No transactions found", description: "The AI could not detect any transactions. Try a clearer file." });
        setAiStage("idle");
        setPreviewImageUrl(null);
        if (aiInputRef.current) aiInputRef.current.value = "";
        return;
      }

      const parsedRows = rawTxs.map((t) => ({
        date: t.date,
        name: t.name,
        amount: Math.abs(t.amount),
        confidence: t.confidence,
        txType: (t.type === "income" ? "income" : "expense") as "income" | "expense",
        incomeCategory: t.incomeSource
          ? (INCOME_CATEGORIES.includes(t.incomeSource as any) ? t.incomeSource as any : "Other Income")
          : undefined,
      }));

      const processed = runRulesEngine(parsedRows, userRules || [], recentTxsForDupeCheck);

      const withConfidence = processed.map((item, i) => ({
        ...item,
        status: parsedRows[i]?.confidence === "low" ? ("review" as const) : item.status,
      }));

      setPreviewItems(withConfidence);
      setAiStage("done");

      const incomeCount = withConfidence.filter((i) => i.txType === "income").length;
      const expenseCount = withConfidence.filter((i) => i.txType === "expense").length;
      toast({
        title: "Statement analyzed",
        description: `Found ${expenseCount} expense${expenseCount !== 1 ? "s" : ""} and ${incomeCount} income transaction${incomeCount !== 1 ? "s" : ""}.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "AI parsing failed";
      toast({ variant: "destructive", title: "AI Parse Error", description: msg });
      setAiStage("idle");
      setPreviewImageUrl(null);
    } finally {
      if (aiInputRef.current) aiInputRef.current.value = "";
    }
  };

  const updateItemAction = (id: string, action: "save" | "skip" | "review") => {
    setPreviewItems((items) => items.map((it) => (it.id === id ? { ...it, action } : it)));
  };

  const updateItemCategory = (id: string, category: string) => {
    setPreviewItems((items) =>
      items.map((it) =>
        it.id === id ? { ...it, resolvedCategory: category as ImportPreviewItem["resolvedCategory"] } : it
      )
    );
  };

  const updateItemIncomeCategory = (id: string, incomeCategory: string) => {
    setPreviewItems((items) =>
      items.map((it) =>
        it.id === id ? { ...it, incomeCategory: incomeCategory as ImportPreviewItem["incomeCategory"] } : it
      )
    );
  };

  const updateItemRecurring = (id: string, recurringBill: boolean) => {
    setPreviewItems((items) => items.map((it) => (it.id === id ? { ...it, recurringBill } : it)));
  };

  const parseDueDayFromDate = (date: string): number => {
    try {
      const parts = date.split("/");
      if (parts.length >= 2) return parseInt(parts[1], 10) || 1;
    } catch { /* noop */ }
    return 1;
  };

  const handleConfirm = async () => {
    const toSave = previewItems.filter((it) => it.action === "save");
    if (toSave.length === 0) {
      toast({ description: "No transactions marked for save." });
      return;
    }

    const payload = toSave.map((it) => {
      let month = selectedMonth;
      try {
        const parts = it.date.split("/");
        if (parts.length === 3) {
          const m = parts[0].padStart(2, "0");
          const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
          month = `${y}-${m}`;
        }
      } catch {
        month = selectedMonth;
      }
      return {
        date: it.date,
        name: it.name,
        amount: it.amount,
        category: it.resolvedCategory,
        status: it.status,
        type: it.txType,
        month,
        isDuplicate: it.isDuplicate ?? false,
        ...(it.txType === "income" && it.incomeCategory ? { incomeCategory: it.incomeCategory } : {}),
        ...(it.ruleApplied ? { ruleApplied: it.ruleApplied } : {}),
      };
    });

    const recurringItems = toSave.filter((it) => it.recurringBill && it.txType === "expense");

    bulkAdd.mutate(payload as any, {
      onSuccess: async () => {
        const saved = toSave.length;
        const inc = toSave.filter((t) => t.txType === "income").length;
        const exp = saved - inc;

        // Switch to the month with the most imported transactions so the user sees their data immediately
        const monthCounts: Record<string, number> = {};
        payload.forEach((p) => { monthCounts[p.month] = (monthCounts[p.month] ?? 0) + 1; });
        const dominantMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (dominantMonth && onMonthChange) onMonthChange(dominantMonth);

        // Create recurring bills for marked items
        let billsAdded = 0;
        for (const item of recurringItems) {
          try {
            await addBill.mutateAsync({
              name: item.name,
              amount: item.amount,
              dueDay: parseDueDayFromDate(item.date),
              category: item.resolvedCategory as any,
              isRecurring: true,
              isPaid: false,
            });
            billsAdded++;
          } catch { /* skip if bill already exists or fails */ }
        }

        const billNote = billsAdded > 0 ? ` — ${billsAdded} recurring bill${billsAdded !== 1 ? "s" : ""} added to Bills list` : "";
        toast({
          title: "Import Successful",
          description: `Saved ${exp} expense${exp !== 1 ? "s" : ""} and ${inc} income transaction${inc !== 1 ? "s" : ""}${billNote}.`,
        });
        setPreviewItems([]);
        setPreviewImageUrl(null);
        setPreviewIsPdf(false);
        setAiStage("idle");
        setLocation("/ledger");
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Import failed";
        toast({ variant: "destructive", title: "Import Failed", description: msg });
      },
    });
  };

  const handleReset = () => {
    setPreviewItems([]);
    setPreviewImageUrl(null);
    setPreviewIsPdf(false);
    setAiStage("idle");
  };

  const isAnalyzing = aiStage === "uploading" || aiStage === "analyzing";
  const incomeItems = previewItems.filter((i) => i.txType === "income");
  const expenseItems = previewItems.filter((i) => i.txType === "expense");
  const totalIncome = incomeItems.filter((i) => i.action === "save").reduce((s, i) => s + i.amount, 0);
  const totalExpense = expenseItems.filter((i) => i.action === "save").reduce((s, i) => s + i.amount, 0);
  const recurringCount = previewItems.filter((i) => i.recurringBill && i.action === "save").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold font-mono tracking-tight uppercase">Data Import</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">
            Target Month: <span className="text-primary">{selectedMonth}</span>
          </p>
        </div>
      </div>

      {!previewItems.length ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode("csv")}
              className={`p-4 rounded-lg border text-left transition-colors ${
                mode === "csv"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50"
              }`}
            >
              <FileSpreadsheet className="w-5 h-5 mb-2" />
              <div className="font-mono text-xs font-bold uppercase tracking-wider">CSV Export</div>
              <div className="text-[11px] mt-1 font-mono opacity-70">Bank CSV files</div>
            </button>
            <button
              onClick={() => setMode("ai")}
              className={`p-4 rounded-lg border text-left transition-colors ${
                mode === "ai"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50"
              }`}
            >
              <Sparkles className="w-5 h-5 mb-2" />
              <div className="font-mono text-xs font-bold uppercase tracking-wider">AI Vision</div>
              <div className="text-[11px] mt-1 font-mono opacity-70">PDF or screenshot — income + expenses</div>
            </button>
          </div>

          {mode === "csv" ? (
            <Card className="border-border border-dashed">
              <CardContent className="flex flex-col items-center justify-center h-52 space-y-4">
                <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
                  <FileSpreadsheet className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground font-mono text-center max-w-xs">
                  Upload your bank's CSV export. Rules engine will auto-categorize and flag duplicates.
                </p>
                <input type="file" accept=".csv" className="hidden" ref={csvInputRef} onChange={handleCSVChange} />
                <Button
                  onClick={() => csvInputRef.current?.click()}
                  disabled={parsing}
                  className="font-mono uppercase text-xs tracking-wider"
                >
                  {parsing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
                  Select CSV File
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border border-dashed">
              <CardContent className="flex flex-col items-center justify-center h-52 space-y-4">
                {isAnalyzing ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                      <Sparkles className="w-7 h-7 text-primary animate-pulse" />
                    </div>
                    <div className="text-center font-mono">
                      <p className="text-sm text-primary font-bold">
                        {aiStage === "uploading" ? "Uploading..." : "Analyzing statement..."}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {aiStage === "analyzing" ? "AI is reading income + expenses" : "Sending file to AI"}
                      </p>
                    </div>
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
                      <Camera className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground font-mono text-center max-w-xs">
                      Upload a PDF or screenshot. AI extracts both income and expenses, categorized by source.
                    </p>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/gif,application/pdf"
                      className="hidden"
                      ref={aiInputRef}
                      onChange={handleAIImageChange}
                    />
                    <Button onClick={() => aiInputRef.current?.click()} className="font-mono uppercase text-xs tracking-wider">
                      <Camera className="w-4 h-4 mr-2" />
                      Upload Statement
                    </Button>
                    <p className="text-[10px] text-muted-foreground font-mono text-center opacity-60">
                      Supports PDF, JPG, PNG, WebP, HEIC — uses AI credits
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {(previewImageUrl || previewIsPdf) && (
            <div className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
              {previewIsPdf ? (
                <div className="w-16 h-16 rounded border border-border bg-secondary flex items-center justify-center flex-shrink-0">
                  <FileText className="w-8 h-8 text-primary" />
                </div>
              ) : (
                <img src={previewImageUrl!} alt="Uploaded statement" className="w-16 h-16 object-cover rounded border border-border flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  {previewIsPdf ? "Source PDF" : "Source image"}
                </p>
                <p className="text-sm font-medium mt-0.5">{previewIsPdf ? "Bank statement PDF" : "Bank statement screenshot"}</p>
                <p className="text-[11px] font-mono text-primary mt-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Parsed with AI — income + expenses
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between bg-card p-4 rounded-lg border border-border flex-wrap gap-3">
            <div className="flex items-center gap-5 text-sm font-mono flex-wrap">
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Total</span>
                <span className="font-bold text-lg">{previewItems.length}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-emerald-400" /> Income
                </span>
                <span className="font-bold text-lg text-emerald-400">
                  {incomeItems.filter((i) => i.action === "save").length}
                  <span className="text-xs ml-1 text-muted-foreground">${totalIncome.toFixed(0)}</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider flex items-center gap-1">
                  <TrendingDown className="w-3 h-3 text-red-400" /> Expenses
                </span>
                <span className="font-bold text-lg text-red-400">
                  {expenseItems.filter((i) => i.action === "save").length}
                  <span className="text-xs ml-1 text-muted-foreground">${totalExpense.toFixed(0)}</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Duplicates</span>
                <span className="font-bold text-lg text-yellow-400">{previewItems.filter((i) => i.isDuplicate).length}</span>
              </div>
              {recurringCount > 0 && (
                <div className="flex flex-col">
                  <span className="text-muted-foreground uppercase text-[10px] tracking-wider flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 text-primary" /> Recurring
                  </span>
                  <span className="font-bold text-lg text-primary">{recurringCount}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleReset} className="font-mono text-xs uppercase tracking-wider">
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
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
                  {visibleItems.map((item) => {
                    const isIncome = item.txType === "income";
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-border/50 ${
                          item.isDuplicate
                            ? "bg-yellow-500/5"
                            : isIncome
                            ? "bg-emerald-500/5"
                            : item.status === "review"
                            ? "bg-orange-500/5"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-xs text-muted-foreground">{item.date}</span>
                            {isIncome ? (
                              <span className="text-[9px] font-mono uppercase tracking-wider bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                <TrendingUp className="w-2.5 h-2.5" /> Income
                              </span>
                            ) : (
                              <span className="text-[9px] font-mono uppercase tracking-wider bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                <TrendingDown className="w-2.5 h-2.5" /> Expense
                              </span>
                            )}
                          </div>
                          <div className="font-medium max-w-[200px] truncate" title={item.name}>
                            {item.name}
                          </div>
                          {item.ruleApplied && (
                            <div className="text-[10px] text-primary/70 font-mono mt-1 flex items-center gap-1">
                              <Check className="w-3 h-3" /> {item.ruleApplied}
                            </div>
                          )}
                          {item.isDuplicate && (
                            <div className="text-[10px] text-yellow-500 font-mono mt-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Potential Duplicate
                            </div>
                          )}
                        </td>
                        <td className={`px-4 py-3 font-mono font-bold text-right ${isIncome ? "text-emerald-400" : ""}`}>
                          {isIncome ? "+" : ""}${item.amount.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          {isIncome ? (
                            <Select
                              value={item.incomeCategory ?? "Other Income"}
                              onValueChange={(v) => updateItemIncomeCategory(item.id, v)}
                            >
                              <SelectTrigger className="h-8 font-mono text-[10px] uppercase w-[130px] bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {INCOME_CATEGORIES.map((cat) => (
                                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="space-y-1.5">
                              <Select
                                value={item.resolvedCategory}
                                onValueChange={(v) => updateItemCategory(item.id, v)}
                              >
                                <SelectTrigger className="h-8 font-mono text-[10px] uppercase w-[120px] bg-transparent border-border">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {allExpenseCategories.map((cat) => (
                                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {item.action === "save" && (
                                <button
                                  onClick={() => updateItemRecurring(item.id, !item.recurringBill)}
                                  className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                                    item.recurringBill
                                      ? "bg-primary/20 text-primary border border-primary/40"
                                      : "bg-transparent text-muted-foreground border border-border/50 hover:border-primary/30 hover:text-primary/70"
                                  }`}
                                >
                                  <RefreshCw className="w-2.5 h-2.5" />
                                  {item.recurringBill ? "Recurring" : "Add Recurring"}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            value={item.action}
                            onValueChange={(v: "save" | "skip" | "review") => updateItemAction(item.id, v)}
                          >
                            <SelectTrigger
                              className={`h-8 font-mono text-[10px] uppercase w-[100px] ${
                                item.action === "save"
                                  ? isIncome
                                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                                    : "text-green-400 border-green-500/30 bg-green-500/10"
                                  : item.action === "skip"
                                  ? "text-muted-foreground border-border bg-transparent"
                                  : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
                              }`}
                            >
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-mono text-muted-foreground">
                Showing {previewPage * PAGE_SIZE + 1}–{Math.min((previewPage + 1) * PAGE_SIZE, previewItems.length)} of {previewItems.length} transactions
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  disabled={previewPage === 0}
                  onClick={() => setPreviewPage((p) => p - 1)}
                >
                  Prev
                </Button>
                <span className="flex items-center font-mono text-xs text-muted-foreground px-1">
                  {previewPage + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  disabled={previewPage >= totalPages - 1}
                  onClick={() => setPreviewPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
