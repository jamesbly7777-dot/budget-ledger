import { useState, useEffect, useMemo } from "react";
import { useBills, useAddBill, useUpdateBill, useDeleteBill, useTransactions } from "@/hooks/use-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2, Plus, Edit2, Trash2, CheckCircle2, Circle, ScanSearch,
  Settings2, Wrench, Trash, RefreshCw, ChevronDown, ChevronUp, ClipboardList,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TransactionCategory, Transaction, Bill } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

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

// Dates are stored as YYYY-MM-DD — extract the day portion (index 2 after splitting on "-")
function parseDueDay(dateStr: string): number {
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const d = parseInt(parts[2], 10);
    if (d >= 1 && d <= 31) return d;
  }
  return 0;
}

function clusterDays(days: number[]): number[][] {
  // Split a set of day-of-month values into distinct clusters (e.g. [7,7,21,21] → [[7,7],[21,21]])
  // Uses a gap threshold: if consecutive sorted days differ by > 10, start a new cluster
  if (!days.length) return [];
  const sorted = [...days].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 10) {
      clusters.push([sorted[i]]);
    } else {
      clusters[clusters.length - 1].push(sorted[i]);
    }
  }
  return clusters;
}

function makeSuggestion(
  key: string,
  txGroup: Transaction[],
  monthCount: number,
  labelSuffix?: string
): SuggestedBill | null {
  const days = txGroup.map((t) => parseDueDay(t.date)).filter((d) => d > 0);
  if (!days.length) return null;
  const avgDay = days.reduce((a, b) => a + b, 0) / days.length;
  const dayStdDev = Math.sqrt(days.reduce((s, d) => s + (d - avgDay) ** 2, 0) / days.length);
  if (dayStdDev > 5) return null; // Within-cluster variance must be tight
  const amounts = txGroup.map((t) => t.amount);
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  if (avgAmount < 10) return null;
  const amtStdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - avgAmount) ** 2, 0) / amounts.length);
  if (amtStdDev / avgAmount > 0.5) return null;
  const nameCounts: Record<string, number> = {};
  txGroup.forEach((t) => { nameCounts[t.name] = (nameCounts[t.name] ?? 0) + 1; });
  const bestName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1])[0][0];
  const catCounts: Record<string, number> = {};
  txGroup.forEach((t) => { catCounts[t.category] = (catCounts[t.category] ?? 0) + 1; });
  const bestCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0] as TransactionCategory;
  const sortedMonths = Array.from(new Set(txGroup.map((t) => t.month))).sort();
  return {
    key: labelSuffix ? `${key}_${labelSuffix}` : key,
    name: labelSuffix ? `${bestName} (${labelSuffix})` : bestName,
    amount: Math.round(avgAmount * 100) / 100,
    dueDay: Math.round(avgDay),
    category: bestCat,
    monthCount,
    confidence: "recurring",
    sourceMonth: sortedMonths[sortedMonths.length - 1] ?? "",
  };
}

function detectRecurringBills(transactions: Transaction[]): SuggestedBill[] {
  const expenses = transactions.filter((t) => !t.type || t.type === "expense");

  // Group all expense transactions by normalized name
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
    // Group transactions by month
    const byMonth: Record<string, Transaction[]> = {};
    for (const tx of txs) {
      if (!byMonth[tx.month]) byMonth[tx.month] = [];
      byMonth[tx.month].push(tx);
    }
    const months = Object.keys(byMonth).sort();
    const uniqueMonthCount = months.length;

    if (uniqueMonthCount < 2) {
      // Seen in only one month — add as "likely" if amount qualifies
      const tx = txs[0];
      if (tx.category === "Transfers") continue;
      if (tx.amount < 15) continue;
      const dueDay = parseDueDay(tx.date);
      if (dueDay < 1) continue;
      suggestions.push({
        key, name: tx.name, amount: tx.amount, dueDay,
        category: tx.category, monthCount: 1,
        confidence: "likely", sourceMonth: tx.month,
      });
      continue;
    }

    // Collect all day-of-month values across all months
    const allDays = txs.map((t) => parseDueDay(t.date)).filter((d) => d > 0);
    const clusters = clusterDays(allDays);

    if (clusters.length === 1) {
      // Standard monthly bill — appears around the same day each month
      const s = makeSuggestion(key, txs, uniqueMonthCount);
      if (s) suggestions.push(s);
    } else {
      // Semi-monthly bill — appears on multiple distinct days per month (e.g. day 7 AND day 21)
      // Each cluster becomes its own recurring bill entry
      const ordinals = ["1st", "2nd", "3rd", "4th"];
      clusters.forEach((cluster, idx) => {
        // Find transactions whose day falls in this cluster
        const clusterTxs = txs.filter((t) => cluster.includes(parseDueDay(t.date)));
        // Only include months that have at least one transaction in this cluster
        const clusterMonths = new Set(clusterTxs.map((t) => t.month));
        if (clusterMonths.size < 2) return; // Need multiple months to be "confirmed"
        const suffix = clusters.length > 1 ? ordinals[idx] ?? `${idx + 1}th` : undefined;
        const s = makeSuggestion(key, clusterTxs, clusterMonths.size, suffix);
        if (s) suggestions.push(s);
      });
    }
  }

  return suggestions.sort((a, b) => a.dueDay - b.dueDay);
}

interface ParsedBill {
  name: string;
  amount: number;
  dueDay: number;
  category: TransactionCategory;
  isRecurring: boolean;
}

function parseBillList(text: string): ParsedBill[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  const getCategoryForSection = (section: string): TransactionCategory => {
    const s = section.toLowerCase();
    if (s.includes("medical") || s.includes("health") || s.includes("ortho") || s.includes("integris")) return "Medical";
    if (s.includes("subscri") || s.includes("stream") || s.includes("app") || s.includes("software")) return "Bills";
    return "Bills";
  };

  interface RawEntry { rawName: string; sectionName: string; amount: number; dueDay: number; category: TransactionCategory; }
  const rawEntries: RawEntry[] = [];
  let currentSectionName = "";
  let currentSectionCategory: TransactionCategory = "Bills";

  for (const line of lines) {
    // Skip separator/decorative lines
    if (/^[━─═=\-*_#\s]+$/.test(line)) continue;
    // Skip lines that are only emojis or section headers with emoji prefix (but no date)
    if (/^[\u{1F300}-\u{1FFFF}]/u.test(line) && !/\d{2}\/\d{2}/.test(line)) continue;

    // Section header: ends with ":" and has no date pattern and no "$"
    // e.g. "Vehicle:", "Medical Bills:", "Affirm:"
    if (/^[A-Za-z\s\/&]+:$/.test(line) && !/\d{2}\/\d{2}/.test(line) && !line.includes("$")) {
      currentSectionName = line.slice(0, -1).trim();
      currentSectionCategory = getCategoryForSection(currentSectionName);
      continue;
    }

    // Skip eliminated/removed items
    if (/ELIMINATED|REMOVED|WINS|SAVINGS|❌|REPLACED/i.test(line)) continue;

    // Handle "Monthly — Name: $Amount" or "~Monthly — Name: ~$Amount" (no specific date — default to day 1)
    const monthlyMatch = line.match(/^~?monthly\s*[—\-–]+\s*(?:([^$~:]+?):\s*)?~?\$?([\d,]+(?:\.\d{1,2})?)/i);
    if (monthlyMatch) {
      const inlineName = monthlyMatch[1]?.trim();
      const amount = parseFloat(monthlyMatch[2].replace(/,/g, ""));
      const rawName = inlineName || currentSectionName;
      if (rawName && amount > 0) {
        rawEntries.push({ rawName, sectionName: currentSectionName, amount, dueDay: 1, category: currentSectionCategory });
      }
      continue;
    }

    // Bill line: "~MM/DD[–MM/DD] — [Name: ]~$Amount"
    // Handles: exact dates, approximate dates (~), date ranges (03/22–03/23)
    const match = line.match(/~?\d{2}\/(\d{2})(?:[–\-]\d{2}\/\d{2})?\s*[—\-–]+\s*(?:([^$~:]+?):\s*)?~?\$?([\d,]+(?:\.\d{1,2})?)/);
    if (match) {
      const day = parseInt(match[1], 10);
      const inlineName = match[2]?.trim();
      const amount = parseFloat(match[3].replace(/,/g, ""));
      const rawName = inlineName || currentSectionName;
      if (!rawName || amount <= 0 || day < 1 || day > 31) continue;
      rawEntries.push({ rawName, sectionName: currentSectionName, amount, dueDay: day, category: currentSectionCategory });
    }
  }

  // Count occurrences of the same name within each section so duplicates get ordinal suffixes
  const sectionNameCounts: Record<string, number> = {};
  for (const e of rawEntries) {
    const k = `${e.sectionName}::${e.rawName}`;
    sectionNameCounts[k] = (sectionNameCounts[k] ?? 0) + 1;
  }

  const sectionNameSeen: Record<string, number> = {};
  const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

  return rawEntries.map((e) => {
    const k = `${e.sectionName}::${e.rawName}`;
    const total = sectionNameCounts[k];
    sectionNameSeen[k] = (sectionNameSeen[k] ?? 0) + 1;
    const instance = sectionNameSeen[k];
    const finalName = total > 1 ? `${e.rawName} (${ordinals[instance - 1] ?? `${instance}th`})` : e.rawName;
    return { name: finalName, amount: e.amount, dueDay: e.dueDay, category: e.category, isRecurring: true };
  });
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

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsedBills, setParsedBills] = useState<ParsedBill[]>([]);
  const [importingPaste, setImportingPaste] = useState(false);

  useEffect(() => { localStorage.setItem("paycheckDays", JSON.stringify(paycheckDays)); }, [paycheckDays]);

  const todayDay = new Date().getDate();

  // "Recurring" section = explicitly recurring OR month-specific bills from ANY other month
  // (bills added in March with isRecurring=false still show every month unless their month === the viewed month)
  const recurringBills = useMemo(
    () => (bills || [])
      .filter((b) => b.isRecurring || !b.month || b.month !== selectedMonth)
      .sort((a, b) => a.dueDay - b.dueDay),
    [bills, selectedMonth]
  );

  // "This month only" = explicitly non-recurring AND locked to THIS specific month
  const monthSpecificBills = useMemo(
    () => (bills || [])
      .filter((b) => !b.isRecurring && b.month === selectedMonth)
      .sort((a, b) => a.dueDay - b.dueDay),
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
    // Show ALL detected patterns — don't filter out already-tracked ones
    // This way the user can see what's detected and what's already in their list
    const found = detectRecurringBills(allTxs);
    if (found.length === 0) {
      toast({ description: `Scanned ${allTxs.length} transactions across ${uniqueMonths} month${uniqueMonths !== 1 ? "s" : ""}. No recurring patterns detected.` });
      return;
    }
    const existingKeys = new Set((bills || []).map((b) => normalizeName(b.name)));
    setSuggestions(found);
    setScanStats({ total: allTxs.length, months: uniqueMonths });
    // Pre-select only bills NOT already tracked
    setSelected(new Set(found.filter((s) => !existingKeys.has(s.key)).map((s) => s.key)));
    const initRecurring: Record<string, boolean> = {};
    found.forEach((s) => { initRecurring[s.key] = true; });
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
    if (!bills) return;
    setIsRunningBulk(true);
    setConfirmAction(null);
    let fixed = 0;
    let errors = 0;
    for (const bill of bills) {
      if (!bill.isRecurring) {
        try {
          // Promote to recurring and erase the month lock (undefined → deleteField in Firestore)
          await updateBill.mutateAsync({ id: bill.id, data: { isRecurring: true, month: undefined } });
          fixed++;
        } catch {
          errors++;
        }
      }
    }
    setIsRunningBulk(false);
    if (errors > 0) {
      toast({ variant: "destructive", description: `${errors} bill${errors !== 1 ? "s" : ""} failed to update. Try again.` });
    } else {
      toast({
        title: "Done",
        description: fixed > 0
          ? `${fixed} bill${fixed !== 1 ? "s" : ""} promoted to Monthly Recurring — they will now appear every month.`
          : "All bills are already Monthly Recurring.",
      });
    }
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
          <Button
            variant="outline"
            onClick={() => { setPasteText(""); setParsedBills([]); setPasteOpen(true); }}
            className="font-mono text-xs uppercase tracking-wider border-primary/40 text-primary hover:bg-primary/10"
          >
            <ClipboardList className="h-4 w-4 mr-2" /> Paste List
          </Button>
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

      {/* Bill sections — shown FIRST so they're immediately visible */}
      {allMonthBills.length === 0 ? (
        <Card className="border-dashed border-2 border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4 text-center">
            <ScanSearch className="w-10 h-10 text-muted-foreground" />
            {(bills || []).some((b) => !b.isRecurring) ? (
              <div>
                <p className="font-mono text-sm text-yellow-400">Bills exist but are locked to a specific month.</p>
                <p className="font-mono text-xs text-muted-foreground/80 mt-1">
                  You have {(bills || []).filter((b) => !b.isRecurring).length} bill{(bills || []).filter((b) => !b.isRecurring).length !== 1 ? "s" : ""} set as month-specific that don&apos;t appear in {selectedMonth}.
                  Use <span className="text-yellow-400">Fix Types</span> above to promote them to Monthly Recurring so they show every month.
                </p>
              </div>
            ) : (
              <div>
                <p className="font-mono text-sm text-muted-foreground">No bills tracked yet.</p>
                <p className="font-mono text-xs text-muted-foreground/60 mt-1">Use Detect to find recurring bills from your transactions, or add one manually.</p>
              </div>
            )}
            <div className="flex gap-2 flex-wrap justify-center">
              {(bills || []).some((b) => !b.isRecurring) && (
                <Button variant="outline" size="sm" onClick={() => setConfirmAction("fix")} disabled={isRunningBulk} className="font-mono text-xs uppercase border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10">
                  <Wrench className="h-3.5 w-3.5 mr-2" /> Fix Types Now
                </Button>
              )}
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

      {/* Paycheck Planner — below sections so bills are always visible first */}
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

      {/* Confirm: Fix Bill Types */}
      <Dialog open={confirmAction === "fix"} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[400px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Fix Bill Types?</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-mono text-muted-foreground">
            This will promote all month-specific bills to <span className="text-primary">Monthly Recurring</span> so they appear every month. Bills confirmed in 2+ months of transactions are always promoted. Bills with no transaction match are also promoted — you can always delete specific ones after.
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
        <DialogContent className="sm:max-w-[420px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-destructive tracking-wider text-sm">Clear All Bills?</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-mono text-muted-foreground">
            This will permanently delete all {(bills || []).length} bill{(bills || []).length !== 1 ? "s" : ""}. Use <span className="text-primary">Clear &amp; Re-detect</span> to immediately scan your transactions for real recurring bills after clearing.
          </p>
          <div className="flex justify-end gap-2 mt-2 flex-wrap">
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button onClick={handleClearAllBills} disabled={isRunningBulk} variant="destructive" className="font-mono text-xs uppercase">
              {isRunningBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash className="w-4 h-4 mr-2" />}
              Delete All
            </Button>
            <Button
              onClick={async () => {
                setConfirmAction(null);
                await handleClearAllBills();
                handleScan();
              }}
              disabled={isRunningBulk}
              className="font-mono text-xs uppercase bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30"
            >
              {isRunningBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanSearch className="w-4 h-4 mr-2" />}
              Clear &amp; Re-detect
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
                {" "}All items default to <span className="text-green-400">Recurring</span> (shows every month).
                Toggle off for one-time bills.
              </p>
            )}
          </DialogHeader>
          {(() => {
            const trackedKeys = new Set((bills || []).map((b) => normalizeName(b.name)));
            const newCount = suggestions.filter((s) => !trackedKeys.has(s.key)).length;
            const alreadyCount = suggestions.length - newCount;
            return (
              <div className="flex gap-3 text-[10px] font-mono py-2">
                <span className="text-green-400">{newCount} new</span>
                {alreadyCount > 0 && <span className="text-blue-400">{alreadyCount} already tracked</span>}
              </div>
            );
          })()}
          <div className="space-y-1 py-1">
            <div className="grid grid-cols-[auto,1fr,auto,auto,auto] gap-x-3 text-[10px] font-mono text-muted-foreground uppercase px-1 pb-1 border-b border-border">
              <span></span><span>Name</span><span>Amount</span><span>Day</span><span>Recurring</span>
            </div>
            {(() => {
              const trackedKeys = new Set((bills || []).map((b) => normalizeName(b.name)));
              return suggestions.map((s) => {
                const alreadyTracked = trackedKeys.has(s.key);
                return (
                  <div key={s.key} className={`grid grid-cols-[auto,1fr,auto,auto,auto] gap-x-3 items-center px-1 py-2 rounded ${alreadyTracked ? "opacity-40" : selected.has(s.key) ? "bg-primary/5" : "opacity-50"}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(s.key)}
                      disabled={alreadyTracked}
                      onChange={(e) => {
                        if (alreadyTracked) return;
                        const next = new Set(selected);
                        e.target.checked ? next.add(s.key) : next.delete(s.key);
                        setSelected(next);
                      }}
                      className="w-4 h-4 accent-primary"
                    />
                    <div>
                      <p className="font-mono text-xs truncate">{s.name}</p>
                      {alreadyTracked ? (
                        <p className="text-[10px] font-mono text-blue-400">Already tracked</p>
                      ) : (
                        <p className={`text-[10px] font-mono ${s.confidence === "recurring" ? "text-green-400" : "text-yellow-400"}`}>
                          {s.confidence === "recurring" ? `Confirmed — ${s.monthCount} months` : "Likely — 1 month"}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-xs">${s.amount.toFixed(2)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{s.dueDay}</span>
                    <Switch
                      checked={perItemRecurring[s.key] ?? s.confidence === "recurring"}
                      onCheckedChange={(v) => setPerItemRecurring({ ...perItemRecurring, [s.key]: v })}
                      disabled={!selected.has(s.key) || alreadyTracked}
                    />
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-xs font-mono text-muted-foreground">{selected.size} new to add</span>
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

      {/* Paste Bill List Dialog */}
      <Dialog open={pasteOpen} onOpenChange={(o) => { if (!o) { setPasteOpen(false); setParsedBills([]); setPasteText(""); } }}>
        <DialogContent className="sm:max-w-[600px] bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-primary tracking-wider text-sm">Paste Bill List</DialogTitle>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              Paste your bills in any format — sections like <span className="text-primary">Vehicle:</span> followed by lines like <span className="text-primary">03/11 — Wells Fargo Auto Loan: $181.39</span>.
              Multiple entries under the same section name (e.g. 4 Affirm payments) automatically get 1st/2nd/3rd labels.
            </p>
          </DialogHeader>

          {parsedBills.length === 0 ? (
            <div className="space-y-3">
              <Textarea
                className="font-mono text-xs bg-input border-border min-h-[280px] resize-none"
                placeholder={"Vehicle:\n03/11 — Wells Fargo Auto Loan: $181.39\n03/23 — Oklahoma Motor Credit: $290.00\n\nSubscriptions:\n03/12 — ChatGPT: $21.19\n03/17 — Planet Fitness: $21.75\n\nMedical Bills:\n03/17 — Integris: $50.00"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setPasteOpen(false); setPasteText(""); }} className="font-mono text-xs uppercase">Cancel</Button>
                <Button
                  onClick={() => {
                    const result = parseBillList(pasteText);
                    if (result.length === 0) {
                      toast({ description: "Could not parse any bills. Make sure each bill line has a date like 03/11 and an amount like $181.39." });
                      return;
                    }
                    setParsedBills(result);
                  }}
                  disabled={!pasteText.trim()}
                  className="font-mono text-xs uppercase"
                >
                  <ScanSearch className="w-4 h-4 mr-2" /> Parse Bills
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-mono text-green-400">{parsedBills.length} bills parsed — review and confirm:</p>
              <div className="border border-border rounded overflow-hidden">
                <div className="grid grid-cols-[1fr,auto,auto,auto] gap-x-3 text-[10px] font-mono text-muted-foreground uppercase px-3 py-2 bg-muted/30 border-b border-border">
                  <span>Name</span><span>Amount</span><span>Day</span><span>Category</span>
                </div>
                <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
                  {parsedBills.map((b, i) => (
                    <div key={i} className="grid grid-cols-[1fr,auto,auto,auto] gap-x-3 items-center px-3 py-2">
                      <span className="font-mono text-xs truncate">{b.name}</span>
                      <span className="font-mono text-xs text-green-400">${b.amount.toFixed(2)}</span>
                      <span className="font-mono text-xs text-muted-foreground">day {b.dueDay}</span>
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">{b.category}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-between items-center pt-1">
                <Button variant="ghost" size="sm" onClick={() => setParsedBills([])} className="font-mono text-xs uppercase text-muted-foreground">
                  Back to Edit
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setPasteOpen(false); setParsedBills([]); setPasteText(""); }} className="font-mono text-xs uppercase">Cancel</Button>
                  <Button
                    onClick={async () => {
                      setImportingPaste(true);
                      let added = 0;
                      for (const b of parsedBills) {
                        try {
                          await addBill.mutateAsync({ name: b.name, amount: b.amount, dueDay: b.dueDay, category: b.category, isRecurring: true, isPaid: false });
                          added++;
                        } catch (e) {
                          console.error("Failed to add bill", b.name, e);
                        }
                      }
                      setImportingPaste(false);
                      setPasteOpen(false);
                      setParsedBills([]);
                      setPasteText("");
                      toast({ title: "Bills imported", description: `${added} of ${parsedBills.length} bills added successfully.` });
                    }}
                    disabled={importingPaste}
                    className="font-mono text-xs uppercase"
                  >
                    {importingPaste ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Import All {parsedBills.length} Bills
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
