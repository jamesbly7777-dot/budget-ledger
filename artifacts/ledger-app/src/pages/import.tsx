import { useState, useRef } from "react";
import { useTransactions, useRules, useBulkAddTransactions } from "@/hooks/use-finance";
import { parseCSV } from "@/lib/csvParser";
import { runRulesEngine } from "@/lib/rulesEngine";
import { ImportPreviewItem } from "@/lib/types";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";

type ImportMode = "csv" | "ai";

const CATEGORIES = [
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

export default function ImportPage({ selectedMonth }: { selectedMonth: string }) {
  const { data: existingTxs } = useTransactions(selectedMonth);
  const { data: userRules } = useRules();
  const bulkAdd = useBulkAddTransactions();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const csvInputRef = useRef<HTMLInputElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<ImportMode>("csv");
  const [parsing, setParsing] = useState(false);
  const [aiStage, setAiStage] = useState<"idle" | "uploading" | "analyzing" | "done">("idle");
  const [previewItems, setPreviewItems] = useState<ImportPreviewItem[]>([]);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

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
      const processed = runRulesEngine(rows, userRules || [], existingTxs || []);
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

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported file",
        description: "Please upload a JPG, PNG, WebP, or HEIC image of your bank statement.",
      });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewImageUrl(objectUrl);
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
          toast({
            variant: "destructive",
            title: "PDF not supported",
            description: errData.error,
          });
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
        confidence: string;
      }>;

      if (!rawTxs || rawTxs.length === 0) {
        toast({
          title: "No transactions found",
          description: "The AI could not detect any transactions in this image. Try a clearer screenshot.",
        });
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
      }));

      const processed = runRulesEngine(parsedRows, userRules || [], existingTxs || []);

      const withConfidence = processed.map((item, i) => ({
        ...item,
        status:
          parsedRows[i]?.confidence === "low"
            ? ("review" as const)
            : item.status,
      }));

      setPreviewItems(withConfidence);
      setAiStage("done");

      toast({
        title: "Statement analyzed",
        description: `Found ${rawTxs.length} transaction${rawTxs.length !== 1 ? "s" : ""}. Review and confirm below.`,
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
      items.map((it) => (it.id === id ? { ...it, resolvedCategory: category as ImportPreviewItem["resolvedCategory"] } : it))
    );
  };

  const handleConfirm = () => {
    const toSave = previewItems.filter((it) => it.action === "save");
    if (toSave.length === 0) {
      toast({ description: "No transactions marked for save." });
      return;
    }

    const payload = toSave.map((it) => ({
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
        setPreviewImageUrl(null);
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
    setAiStage("idle");
  };

  const isAnalyzing = aiStage === "uploading" || aiStage === "analyzing";

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
              <div className="text-[11px] mt-1 font-mono opacity-70">Screenshot or photo</div>
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
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  ref={csvInputRef}
                  onChange={handleCSVChange}
                />
                <Button
                  onClick={() => csvInputRef.current?.click()}
                  disabled={parsing}
                  className="font-mono uppercase text-xs tracking-wider"
                >
                  {parsing ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <UploadCloud className="w-4 h-4 mr-2" />
                  )}
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
                        {aiStage === "analyzing"
                          ? "AI is reading your transactions"
                          : "Sending image to AI"}
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
                      Take a screenshot of your bank's transaction list and upload it. AI will extract all transactions automatically.
                    </p>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/gif"
                      className="hidden"
                      ref={aiInputRef}
                      onChange={handleAIImageChange}
                    />
                    <Button
                      onClick={() => aiInputRef.current?.click()}
                      className="font-mono uppercase text-xs tracking-wider"
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Upload Screenshot
                    </Button>
                    <p className="text-[10px] text-muted-foreground font-mono text-center opacity-60">
                      Supports JPG, PNG, WebP, HEIC — uses AI credits
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {previewImageUrl && (
            <div className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
              <img
                src={previewImageUrl}
                alt="Uploaded statement"
                className="w-16 h-16 object-cover rounded border border-border"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Source image</p>
                <p className="text-sm font-medium mt-0.5">Bank statement screenshot</p>
                <p className="text-[11px] font-mono text-primary mt-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Parsed with AI vision
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between bg-card p-4 rounded-lg border border-border">
            <div className="flex items-center gap-6 text-sm font-mono">
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Total Parsed</span>
                <span className="font-bold text-lg">{previewItems.length}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">To Save</span>
                <span className="font-bold text-lg text-green-400">
                  {previewItems.filter((i) => i.action === "save").length}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Duplicates</span>
                <span className="font-bold text-lg text-red-400">
                  {previewItems.filter((i) => i.isDuplicate).length}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Review</span>
                <span className="font-bold text-lg text-yellow-400">
                  {previewItems.filter((i) => i.action === "review").length}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                className="font-mono text-xs uppercase tracking-wider"
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={bulkAdd.isPending}
                className="font-mono text-xs uppercase tracking-wider"
              >
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
                    <tr
                      key={item.id}
                      className={`border-b border-border/50 ${
                        item.isDuplicate
                          ? "bg-red-500/5"
                          : item.status === "review"
                          ? "bg-yellow-500/5"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs text-muted-foreground mb-1">{item.date}</div>
                        <div className="font-medium max-w-[200px] truncate" title={item.name}>
                          {item.name}
                        </div>
                        {item.ruleApplied && (
                          <div className="text-[10px] text-primary/70 font-mono mt-1 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            {item.ruleApplied}
                          </div>
                        )}
                        {item.isDuplicate && (
                          <div className="text-[10px] text-destructive font-mono mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Potential Duplicate
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-right">
                        ${item.amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={item.resolvedCategory}
                          onValueChange={(v) => updateItemCategory(item.id, v)}
                        >
                          <SelectTrigger className="h-8 font-mono text-[10px] uppercase w-[120px] bg-transparent border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((cat) => (
                              <SelectItem key={cat} value={cat}>
                                {cat}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={item.action}
                          onValueChange={(v: "save" | "skip" | "review") =>
                            updateItemAction(item.id, v)
                          }
                        >
                          <SelectTrigger
                            className={`h-8 font-mono text-[10px] uppercase w-[100px] ${
                              item.action === "save"
                                ? "text-green-400 border-green-500/30 bg-green-500/10"
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
