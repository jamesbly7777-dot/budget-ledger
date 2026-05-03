import { useState, useEffect, useMemo, useCallback } from "react";
import { useBills, useAddBill, useUpdateBill, useDeleteBill, useDeleteTransaction, useTransactions, useAddTransaction, useCustomCategories, useSaveCustomCategories } from "@/hooks/use-finance";
import * as firestoreService from "@/lib/firestoreService";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2, Plus, Edit2, Trash2, CheckCircle2, Circle, ScanSearch,
  Settings2, Wrench, Trash, RefreshCw, ChevronDown, ChevronUp, ClipboardList,
  PlusCircle, X, Link2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TransactionCategory, Transaction, Bill, DEFAULT_EXPENSE_CATEGORIES } from "@/lib/types";
import {
  isPaidInMonth,
  findLinkedTransaction,
  findPotentialDuplicates,
  computeBillManagerReconciliation,
  computeBillManagerMonthTotals,
  buildMonthAuditReport,
  filterAuditedTransactions,
  filterTransactionsToCalendarMonth,
  type MonthAuditOptions,
} from "@/lib/billStatus";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

interface SuggestedBill {
  key: string;
  name: string;
  amount: number;
  dueDay: number;
  category: string;
  monthCount: number;
  confidence: "recurring" | "likely";
  sourceMonth: string;
}

interface DuplicateBillGroup {
  id: string;
  bills: Bill[];
  keepId: string;
  suggestedDeleteIds: Set<string>;
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

function normalizeBillAliasKey(name: string): string {
  return normalizeName(name)
    .replace(/\bpurchase\b/g, "")
    .replace(/\bfin\b/g, "finance")
    .replace(/\bflexible\b/g, "flex")
    .replace(/\bfinance\b/g, "finance")
    .replace(/\bnew\b/g, "")
    .replace(/\byork\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  "Transfers", "Personal", "Waste", "Work", "Uncategorized",
];

const BLANK_FORM = {
  name: "", amount: "", dueDay: "1",
  category: "Bills" as string, isRecurring: true,
};

// ─── BillRow ──────────────────────────────────────────────────────────────────
interface BillRowProps {
  bill: Bill;
  compact?: boolean;
  selectedMonth: string;
  todayDay: number;
  ledgerLinked?: Transaction;
  onTogglePaid: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
  onDelete: (id: string) => void;
}

function BillRow({ bill, compact = false, selectedMonth, todayDay, ledgerLinked, onTogglePaid, onEdit, onDelete }: BillRowProps) {
  const manuallyPaid = isPaidInMonth(bill, selectedMonth);
  const paid = manuallyPaid || !!ledgerLinked;
  const isOverdue = !paid && bill.dueDay < todayDay;
  const isDueToday = !paid && bill.dueDay === todayDay;
  const isDueSoon = !paid && bill.dueDay > todayDay && bill.dueDay - todayDay <= 3;
  const [selYear, selMonth] = selectedMonth.split("-").map(Number);
  const dueDateObj = new Date(selYear, selMonth - 1, bill.dueDay);
  const formattedDate = dueDateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className={`flex items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/20 ${paid ? "opacity-60" : isOverdue ? "bg-red-500/5" : isDueToday ? "bg-yellow-500/5" : ""}`}>
      <div className="flex-shrink-0 text-center min-w-[44px]">
        <span className={`font-mono text-xs font-bold block ${isOverdue ? "text-red-400" : isDueToday ? "text-yellow-400" : "text-primary"}`}>{formattedDate}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-mono text-sm truncate ${paid ? "line-through text-muted-foreground" : ""}`}>{bill.name}</p>
        {!compact && (
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">{bill.category}</span>
            {ledgerLinked && (
              <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-1.5 rounded flex items-center gap-0.5">
                <Link2 className="w-2.5 h-2.5" /> Ledger
              </span>
            )}
            {isOverdue && <span className="text-[10px] font-mono text-red-400 bg-red-500/10 px-1 rounded">OVERDUE</span>}
            {isDueToday && <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 px-1 rounded">TODAY</span>}
            {isDueSoon && <span className="text-[10px] font-mono text-orange-400 bg-orange-500/10 px-1 rounded">SOON</span>}
          </div>
        )}
      </div>
      <span className={`font-mono font-bold text-sm flex-shrink-0 ${paid ? "text-muted-foreground" : ""}`}>${bill.amount.toFixed(2)}</span>
      <button
        onClick={() => !ledgerLinked && onTogglePaid(bill)}
        className={`transition-colors flex-shrink-0 ${ledgerLinked ? "cursor-default text-blue-400" : "text-muted-foreground hover:text-primary"}`}
        title={ledgerLinked ? `Paid via Ledger: ${ledgerLinked.name}` : paid ? "Mark unpaid" : "Mark paid"}
      >
        {paid ? <CheckCircle2 className={`w-5 h-5 ${ledgerLinked ? "text-blue-400" : "text-green-500"}`} /> : <Circle className="w-5 h-5" />}
      </button>
      {!compact && (
        <>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary flex-shrink-0" onClick={() => onEdit(bill)} title="Edit">
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0" onClick={() => onDelete(bill.id)} title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────
function SectionHeader({
  title, count, total, paidTotal, collapsed, onToggle,
}: { title: string; count: number; total: number; paidTotal: number; collapsed: boolean; onToggle: () => void }) {
  return (
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
}

export default function BillsPage({ selectedMonth }: { selectedMonth: string }) {
  const { user } = useAuth();
  const { data: bills, isLoading: billsLoading, refetch: refetchBills } = useBills();
  // All transactions (background) used for Detect feature
  const { data: allTxs } = useTransactions();
  // Selected month transactions used for Ledger ↔ Bill Manager link detection
  const { data: monthTxs, refetch: refetchMonthTxs } = useTransactions(selectedMonth);
  const calendarMonthTxs = useMemo(
    () => filterTransactionsToCalendarMonth(monthTxs || [], selectedMonth),
    [monthTxs, selectedMonth],
  );
  const finalMonthTxs = useMemo(
    () => filterAuditedTransactions(calendarMonthTxs),
    [calendarMonthTxs],
  );
  const addBill = useAddBill();
  const updateBill = useUpdateBill();
  const deleteBill = useDeleteBill();
  const deleteTx = useDeleteTransaction();
  const addTx = useAddTransaction();
  const { toast } = useToast();
  const { data: customCats = [] } = useCustomCategories();
  const saveCustomCats = useSaveCustomCategories();

  const allCategories = useMemo(() => {
    const extras = (customCats || []).filter((c) => !DEFAULT_EXPENSE_CATEGORIES.includes(c));
    return [...DEFAULT_EXPENSE_CATEGORIES, ...extras];
  }, [customCats]);

  const [addingCustomCat, setAddingCustomCat] = useState(false);
  const [newCustomCatInput, setNewCustomCatInput] = useState("");

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
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [isTogglingUnpaid, setIsTogglingUnpaid] = useState(false);
  const [formData, setFormData] = useState(BLANK_FORM);
  const [confirmAction, setConfirmAction] = useState<null | "fix" | "clear" | "markAllPaid" | "monthAudit">(null);
  const [isRunningBulk, setIsRunningBulk] = useState(false);
  const [duplicateBillsOpen, setDuplicateBillsOpen] = useState(false);
  const [selectedDuplicateBillIds, setSelectedDuplicateBillIds] = useState<Set<string>>(new Set());
  const [removingDuplicateBills, setRemovingDuplicateBills] = useState(false);

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

  const duplicateBillGroups = useMemo<DuplicateBillGroup[]>(() => {
    const groups = new Map<string, Bill[]>();
    for (const bill of allMonthBills) {
      const key = `${normalizeName(bill.name)}|${Math.abs(bill.amount).toFixed(2)}`;
      const group = groups.get(key) ?? [];
      group.push(bill);
      groups.set(key, group);
    }
    return Array.from(groups.entries())
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => {
        const sorted = [...group].sort((a, b) => {
          const paidDiff = (b.paidMonths?.length ?? 0) - (a.paidMonths?.length ?? 0);
          if (paidDiff !== 0) return paidDiff;
          const recurringDiff = Number(b.isRecurring) - Number(a.isRecurring);
          if (recurringDiff !== 0) return recurringDiff;
          return a.dueDay - b.dueDay;
        });
        const keepId = sorted[0].id;
        return {
          id: key,
          bills: sorted,
          keepId,
          suggestedDeleteIds: new Set(sorted.slice(1).map((bill) => bill.id)),
        };
      });
  }, [allMonthBills]);

  const fuzzyDuplicateBillGroups = useMemo<DuplicateBillGroup[]>(() => {
    const groups = new Map<string, Bill[]>();
    const exactDuplicateBillIds = new Set(duplicateBillGroups.flatMap((group) => group.bills.map((bill) => bill.id)));
    for (const bill of allMonthBills) {
      if (exactDuplicateBillIds.has(bill.id)) continue;
      const aliasKey = normalizeBillAliasKey(bill.name);
      if (!aliasKey) continue;
      const key = `${aliasKey}|${Math.abs(bill.amount).toFixed(2)}`;
      const group = groups.get(key) ?? [];
      group.push(bill);
      groups.set(key, group);
    }
    return Array.from(groups.entries())
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => {
        const sorted = [...group].sort((a, b) => {
          const paidDiff = (b.paidMonths?.length ?? 0) - (a.paidMonths?.length ?? 0);
          if (paidDiff !== 0) return paidDiff;
          return a.dueDay - b.dueDay;
        });
        return {
          id: key,
          bills: sorted,
          keepId: sorted[0].id,
          suggestedDeleteIds: new Set(sorted.slice(1).map((bill) => bill.id)),
        };
      });
  }, [allMonthBills, duplicateBillGroups]);

  const allDuplicateBillGroups = useMemo(
    () => [...duplicateBillGroups, ...fuzzyDuplicateBillGroups],
    [duplicateBillGroups, fuzzyDuplicateBillGroups],
  );

  // Map from bill.id → matching ledger transaction for the selected month
  const ledgerLinkedMap = useMemo(() => {
    const map = new Map<string, Transaction>();
    if (!finalMonthTxs.length || !bills) return map;
    for (const bill of bills) {
      const linked = findLinkedTransaction(bill, finalMonthTxs);
      if (linked) map.set(bill.id, linked);
    }
    return map;
  }, [bills, finalMonthTxs]);

  // True if a bill is paid either manually or via a matching ledger transaction
  const isEffectivelyPaid = useCallback(
    (b: Bill) => isPaidInMonth(b, selectedMonth) || ledgerLinkedMap.has(b.id),
    [selectedMonth, ledgerLinkedMap]
  );

  const [overageOverrides, setOverageOverrides] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("overageOverrides") || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .map((x: unknown) => {
          if (typeof x !== "string") return "";
          const t = x.trim();
          if (!t) return "";
          const colon = t.indexOf(":");
          if (colon > 0 && /^[a-z]+$/i.test(t.slice(0, colon).trim())) return t.slice(0, colon).trim();
          return t;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem("overageOverrides", JSON.stringify(overageOverrides));
  }, [overageOverrides]);
  const recurringAllowedSet = useMemo(() => new Set(overageOverrides), [overageOverrides]);
  const auditOptions = useMemo<MonthAuditOptions>(
    () => ({ recurringOverageAllowedKeys: recurringAllowedSet }),
    [recurringAllowedSet],
  );
  const billMonthTotals = useMemo(
    () => computeBillManagerMonthTotals(bills || [], selectedMonth, finalMonthTxs, auditOptions),
    [bills, selectedMonth, finalMonthTxs, auditOptions],
  );
  const reconciliation = useMemo(
    () => computeBillManagerReconciliation(bills || [], selectedMonth, finalMonthTxs, auditOptions),
    [bills, selectedMonth, finalMonthTxs, auditOptions],
  );
  const monthAudit = useMemo(
    () => buildMonthAuditReport(finalMonthTxs, auditOptions),
    [finalMonthTxs, auditOptions],
  );
  const effectiveOverages = monthAudit.recurringOverages.filter((o) => {
    const key = o.split(":")[0]?.trim() ?? "";
    return !overageOverrides.includes(key);
  });
  const hasValidationWarning =
    Math.abs(reconciliation.dashboardSpending - monthAudit.auditedSpending) > 0.01 ||
    reconciliation.unmatchedBills.length > 0 ||
    effectiveOverages.length > 0;
  const totalAmount = billMonthTotals.totalAmount;
  const paidAmount = billMonthTotals.paidAmount;
  const remaining = billMonthTotals.remainingAmount;

  const [pc1, pc2] = paycheckDays;
  const paycheckConfigured = pc1 > 0 && pc2 > 0 && pc1 !== pc2;

  const window1Bills = paycheckConfigured
    ? allMonthBills.filter((b) => pc1 < pc2 ? (b.dueDay >= pc1 && b.dueDay < pc2) : (b.dueDay >= pc1 || b.dueDay < pc2))
    : [];
  const window2Bills = paycheckConfigured
    ? allMonthBills.filter((b) => pc1 < pc2 ? (b.dueDay >= pc2 || b.dueDay < pc1) : (b.dueDay >= pc2 && b.dueDay < pc1))
    : [];

  // onSnapshot handles all UI updates automatically — no manual cache management needed.

  // Calls Firestore directly — does NOT use the shared addTx mutation instance
  const addBillToLedgerDirect = async (bill: Bill): Promise<string> => {
    const day = String(bill.dueDay).padStart(2, "0");
    const date = `${selectedMonth}-${day}`;
    return firestoreService.addTransaction(user!.uid, {
      date,
      name: bill.name,
      amount: bill.amount,
      category: bill.category as any,
      status: "cleared",
      type: "expense",
      month: selectedMonth,
      note: "Added from Bill Manager",
      billId: bill.id,
      source: "linked_bill",
    } as any);
  };

  // Hook-based version for the singular "mark paid" path (sequential, safe)
  const addBillToLedger = (bill: Bill) => {
    const day = String(bill.dueDay).padStart(2, "0");
    const date = `${selectedMonth}-${day}`;
    return addTx.mutateAsync({
      date,
      name: bill.name,
      amount: bill.amount,
      category: bill.category as any,
      status: "cleared",
      type: "expense",
      month: selectedMonth,
      note: "Added from Bill Manager",
      billId: bill.id,
      source: "linked_bill",
    } as any);
  };

  const togglePaid = async (bill: Bill) => {
    const currentlyManuallyPaid = isPaidInMonth(bill, selectedMonth);
    const currentlyLinked = ledgerLinkedMap.has(bill.id);
    if (currentlyLinked) return; // Auto-paid via ledger — cannot toggle manually

    if (currentlyManuallyPaid) {
      // Marking unpaid — write to Firestore; onSnapshot listener updates the UI automatically
      if (bill.isRecurring) {
        const newPaidMonths = (bill.paidMonths ?? []).filter((m) => m !== selectedMonth);
        await firestoreService.updateBill(user!.uid, bill.id, { paidMonths: newPaidMonths });
      } else {
        await firestoreService.updateBill(user!.uid, bill.id, { isPaid: false });
      }
      const log = await firestoreService.getBillManagerLog(user!.uid, selectedMonth);
      const txId = log[bill.id];
      if (txId) {
        await firestoreService.deleteTransaction(user!.uid, txId);
        await firestoreService.removeBillManagerEntry(user!.uid, selectedMonth, bill.id);
        toast({ description: `${bill.name} marked unpaid and ledger entry removed.` });
      } else {
        toast({ description: `${bill.name} marked unpaid.` });
      }
    } else {
      // Marking paid — write to Firestore; onSnapshot listener updates the UI automatically
      if (bill.isRecurring) {
        const newPaidMonths = [...(bill.paidMonths ?? []), selectedMonth];
        await firestoreService.updateBill(user!.uid, bill.id, { paidMonths: newPaidMonths });
      } else {
        await firestoreService.updateBill(user!.uid, bill.id, { isPaid: true });
      }
      const txId = await addBillToLedgerDirect(bill);
      if (txId) await firestoreService.saveBillManagerEntry(user!.uid, selectedMonth, bill.id, txId);
      toast({ description: `${bill.name} marked paid and added to Ledger.` });
    }
  };

  const [isMarkingAllPaid, setIsMarkingAllPaid] = useState(false);

  const markAllPaid = async () => {
    setIsMarkingAllPaid(true);
    setConfirmAction(null);
    try {
      // Only skip bills already in paidMonths — do NOT skip ledger-linked bills.
      // Ledger-linked bills still need to be added to paidMonths so Undo All can clear them.
      const billsToMark = allMonthBills.filter((b) => !isPaidInMonth(b, selectedMonth));
      const entries = await Promise.all(
        billsToMark.map(async (bill) => {
          if (bill.isRecurring) {
            await firestoreService.updateBill(user!.uid, bill.id, { paidMonths: [...(bill.paidMonths ?? []), selectedMonth] });
          } else {
            await firestoreService.updateBill(user!.uid, bill.id, { isPaid: true });
          }
          // Skip creating a ledger entry for bills already covered by an imported transaction
          if (ledgerLinkedMap.has(bill.id)) return { billId: bill.id, txId: null, bill };
          const txId = await addBillToLedgerDirect(bill);
          return { billId: bill.id, txId, bill };
        })
      );
      // Save txId log so undo knows exactly which transactions to delete
      await Promise.all(
        entries.filter((e) => !!e.txId).map((e) =>
          firestoreService.saveBillManagerEntry(user!.uid, selectedMonth, e.billId, e.txId!)
        )
      );
      if (entries.some((entry) => entry.txId)) await firestoreService.recalculateMonthTotals(user!.uid, selectedMonth);
      const prevAffected = await firestoreService.getMarkAllPaidAffectedBillIds(user!.uid, selectedMonth);
      const mergedAffected = Array.from(
        new Set([...(prevAffected ?? []), ...billsToMark.map((b) => b.id)])
      );
      await firestoreService.saveMarkAllPaidAffectedBillIds(user!.uid, selectedMonth, mergedAffected);
      toast({ description: `${billsToMark.length} bill${billsToMark.length !== 1 ? "s" : ""} marked paid.` });
    } catch {
      toast({ description: "Something went wrong marking bills paid. Please try again." });
    } finally {
      setIsMarkingAllPaid(false);
    }
  };

  const [isUndoingAll, setIsUndoingAll] = useState(false);

  const markAllUnpaid = async () => {
    setIsUndoingAll(true);
    try {
      const snapshotAffected = await firestoreService.getMarkAllPaidAffectedBillIds(user!.uid, selectedMonth);
      const billIds = new Set(allMonthBills.map((bill) => bill.id));
      const log = await firestoreService.getBillManagerLog(user!.uid, selectedMonth);

      // 1. Only revert paid flags for bills that Mark All Paid actually touched — not bills
      //    that were already paid for this month before Mark All (restores true previous state).
      //    Legacy: no snapshot → revert bills that have Bill Manager log / auto-ledger rows only.
      let revertIds: Set<string>;
      if (snapshotAffected !== undefined) {
        revertIds = new Set(snapshotAffected.filter((id) => billIds.has(id)));
      } else {
        revertIds = new Set(Object.keys(log));
        for (const tx of monthTxs ?? []) {
          if (tx.note === "Added from Bill Manager" && tx.billId && billIds.has(tx.billId)) {
            revertIds.add(tx.billId);
          }
        }
      }

      await Promise.all(
        allMonthBills
          .filter((bill) => revertIds.has(bill.id))
          .map((bill) =>
            bill.isRecurring
              ? firestoreService.updateBill(user!.uid, bill.id, {
                  paidMonths: (bill.paidMonths ?? []).filter((m) => m !== selectedMonth),
                })
              : firestoreService.updateBill(user!.uid, bill.id, { isPaid: false })
          )
      );

      // 2. Look up exact txIds from the log, then fall back to live Bill Manager ledger entries.
      // Replit patches often only used the log; if that write missed, the ledger-linked rows kept bills looking paid.
      const loggedTxIds = Object.values(log).filter(Boolean);
      const liveBillManagerTxIds = (monthTxs ?? [])
        .filter((tx) => tx.note === "Added from Bill Manager" && tx.billId && billIds.has(tx.billId))
        .map((tx) => tx.id);
      const txIds = Array.from(new Set([...loggedTxIds, ...liveBillManagerTxIds]));
      await Promise.all(txIds.map((txId) => firestoreService.deleteTransaction(user!.uid, txId)));
      await firestoreService.clearBillManagerMonth(user!.uid, selectedMonth);
      await firestoreService.clearMarkAllPaidSnapshot(user!.uid, selectedMonth);
      if (txIds.length > 0) await firestoreService.recalculateMonthTotals(user!.uid, selectedMonth);

      toast({
        description: txIds.length > 0
          ? `Undone. Removed ${txIds.length} ledger entr${txIds.length === 1 ? "y" : "ies"}.`
          : "Bills marked unpaid.",
      });
    } finally {
      setIsUndoingAll(false);
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
    const dueDay = parseInt(formData.dueDay);
    const date = `${selectedMonth}-${String(dueDay).padStart(2, "0")}`;
    const amount = Math.abs(parseFloat(formData.amount));
    const potentialDuplicates = findPotentialDuplicates(
      { name: formData.name, amount, date, category: formData.category },
      calendarMonthTxs,
    );
    if (!editingId && potentialDuplicates.length > 0) {
      toast({
        variant: "destructive",
        title: "Possible duplicate bill",
        description: `Found ${potentialDuplicates.length} similar transaction${potentialDuplicates.length !== 1 ? "s" : ""} within 5 days. Link to existing ledger activity instead of adding another bill.`,
      });
      return;
    }
    const payload = {
      name: formData.name,
      amount,
      dueDay,
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
    setEditingBill(b);
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

  const openDuplicateBillCleanup = () => {
    const defaults = new Set<string>();
    allDuplicateBillGroups.forEach((group) => group.suggestedDeleteIds.forEach((id) => defaults.add(id)));
    setSelectedDuplicateBillIds(defaults);
    setDuplicateBillsOpen(true);
  };

  const handleRemoveDuplicateBills = async () => {
    const ids = Array.from(selectedDuplicateBillIds);
    if (!ids.length) return;
    setRemovingDuplicateBills(true);
    try {
      for (const id of ids) {
        await deleteBill.mutateAsync(id);
      }
      toast({
        title: "Duplicate bills removed",
        description: `Removed ${ids.length} duplicate bill${ids.length !== 1 ? "s" : ""}.`,
      });
      setDuplicateBillsOpen(false);
      setSelectedDuplicateBillIds(new Set());
    } finally {
      setRemovingDuplicateBills(false);
    }
  };

  const runMonthAuditCleanup = async () => {
    if (!monthTxs) return;
    setIsRunningBulk(true);
    setConfirmAction(null);
    try {
      const report = buildMonthAuditReport(finalMonthTxs);
      const toDelete = new Set([
        ...report.duplicateCandidateIds,
        ...report.splitComponentIds,
        ...report.duplicateIncomeCandidateIds,
      ]);

      for (const txId of toDelete) {
        await deleteTx.mutateAsync({ id: txId, month: selectedMonth });
      }
      await firestoreService.recalculateMonthTotals(user!.uid, selectedMonth);
      toast({
        title: "Month audit applied",
        description: `Removed ${toDelete.size} flagged transaction${toDelete.size !== 1 ? "s" : ""} for ${selectedMonth}.`,
      });
    } catch {
      toast({ variant: "destructive", description: "April cleanup failed. Try again." });
    } finally {
      setIsRunningBulk(false);
    }
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

  if (billsLoading) {
    return <div className="flex h-[50vh] items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const billRowProps = { selectedMonth, todayDay, onTogglePaid: togglePaid, onEdit: openEdit, onDelete: handleDelete };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4 surface-tech-strong p-5 sm:p-6 rounded-xl">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-1 w-8 rounded-full bg-gradient-to-r from-primary to-emerald-400 shadow-[0_0_12px_hsl(187_100%_50%_/_.5)]" />
            <span className="text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground">Billing</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.12em] uppercase text-glow-cyan">
            Bill Manager
          </h2>
          <p className="text-muted-foreground font-mono text-xs sm:text-sm mt-2">
            <span className="text-primary font-semibold">{selectedMonth}</span>
            {" · "}
            Bills Paid: <span className="text-emerald-400 tabular-nums">${paidAmount.toFixed(2)}</span>
            {" · "}
            Remaining: <span className="text-red-400 tabular-nums">${remaining.toFixed(2)}</span>
            {" · "}
            Total: <span className="text-primary tabular-nums">${totalAmount.toFixed(2)}</span>
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
            <Button variant="warning" onClick={() => setConfirmAction("fix")} disabled={isRunningBulk} className="font-mono text-xs uppercase tracking-wider">
              {isRunningBulk ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
              Fix Types
            </Button>
          )}
          {(bills || []).length > 0 && (
            <Button variant="destructive" onClick={() => setConfirmAction("clear")} disabled={isRunningBulk} className="font-mono text-xs uppercase tracking-wider">
              <Trash className="h-4 w-4 mr-2" /> Clear All
            </Button>
          )}
          {allDuplicateBillGroups.length > 0 && (
            <Button
              variant="warning"
              onClick={openDuplicateBillCleanup}
              disabled={removingDuplicateBills}
              className="font-mono text-xs uppercase tracking-wider"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clean Duplicates ({allDuplicateBillGroups.reduce((sum, group) => sum + group.suggestedDeleteIds.size, 0)})
            </Button>
          )}
          <Button
            variant="warning"
            onClick={() => setConfirmAction("monthAudit")}
            disabled={isRunningBulk}
            className="font-mono text-xs uppercase tracking-wider"
          >
            <RefreshCw className="h-4 w-4 mr-2" /> Month Audit Fix
          </Button>
          <Button
            variant="secondary"
            onClick={() => { setPasteText(""); setParsedBills([]); setPasteOpen(true); }}
            className="font-mono text-xs uppercase tracking-wider"
          >
            <ClipboardList className="h-4 w-4 mr-2" /> Paste List
          </Button>
          <Button onClick={() => { setFormData(BLANK_FORM); setEditingId(null); setIsDialogOpen(true); }} className="font-mono text-xs uppercase tracking-wider">
            <Plus className="h-4 w-4 mr-2" /> Add Bill
          </Button>
        </div>
      </div>

      <Card className="surface-tech border-orange-500/25">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-xs uppercase tracking-wider text-orange-300">Bills Reconciliation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 font-mono text-xs">
            <p>Dashboard Total Spending: <span className="text-primary">${reconciliation.dashboardSpending.toFixed(2)}</span></p>
            <p>Bill Manager Paid: <span className="text-emerald-400">${reconciliation.paidAmount.toFixed(2)}</span></p>
            <p>Bill Manager Remaining: <span className="text-red-400">${reconciliation.remainingAmount.toFixed(2)}</span></p>
            <p>Bill Manager Total: <span className="text-primary">${reconciliation.totalAmount.toFixed(2)}</span></p>
            <p>Clean Bill Tx Count: <span className="text-cyan-300">{reconciliation.cleanBillTransactions.length}</span></p>
            <p>Paid vs Dashboard Diff: <span className="text-yellow-300">${(reconciliation.paidAmount - reconciliation.dashboardSpending).toFixed(2)}</span></p>
          </div>
          {hasValidationWarning && (
            <p className="text-xs font-mono text-red-300">
              Financial data not fully validated.
            </p>
          )}
          {reconciliation.warning && (
            <p className="text-xs font-mono text-yellow-300">
              Unmatched manual bills found — review before totals are trusted.
            </p>
          )}
          {monthAudit.recurringOverageRows.length > 0 && (
            <div className="space-y-2 border border-yellow-500/20 rounded p-2">
              <p className="text-[10px] font-mono uppercase text-yellow-300">Recurring Overages</p>
              {monthAudit.recurringOverageRows.map((row) => {
                const label =
                  monthAudit.recurringOverages.find((o) => o.startsWith(`${row.key}:`)) ?? `${row.key} over limit`;
                const overridden = overageOverrides.includes(row.key);
                const culpritTxs = row.txIds
                  .map((id) => (monthTxs || []).find((t) => t.id === id) ?? calendarMonthTxs.find((t) => t.id === id))
                  .filter((t): t is Transaction => !!t);
                return (
                  <div key={row.key} className="space-y-1 text-[11px] font-mono">
                    <div className="flex items-center justify-between gap-2">
                      <span className={overridden ? "text-muted-foreground line-through" : "text-yellow-200"}>
                        {label}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 shrink-0 px-2 text-[10px] font-mono"
                        onClick={() => {
                          setOverageOverrides((prev) =>
                            overridden ? prev.filter((x) => x !== row.key) : [...prev, row.key],
                          );
                        }}
                      >
                        {overridden ? "Undo Override" : "Allow multiple charges this month"}
                      </Button>
                    </div>
                    {culpritTxs.length > 0 && (
                      <ul className="pl-2 text-[10px] text-muted-foreground space-y-0.5 border-l border-yellow-500/20 ml-1">
                        {culpritTxs.map((t) => (
                          <li key={t.id}>
                            {t.date} · {t.name} · ${Math.abs(t.amount).toFixed(2)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="max-h-24 overflow-y-auto space-y-1">
            {reconciliation.unmatchedBills.slice(0, 8).map((bill) => (
              <p key={bill.id} className="text-[11px] font-mono text-muted-foreground">
                {String(bill.dueDay).padStart(2, "0")} · {bill.name} · ${bill.amount.toFixed(2)}
              </p>
            ))}
            {reconciliation.unmatchedBills.length === 0 && (
              <p className="text-[11px] font-mono text-emerald-400">No unmatched bills.</p>
            )}
          </div>
          <div className="border-t border-border/40 pt-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Per-bill Status</p>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {reconciliation.billStatuses.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="truncate text-muted-foreground">
                    {item.mode} · {item.label}
                  </span>
                  <span
                    className={
                      item.status === "PAID"
                        ? "text-emerald-400"
                        : item.status === "UNDERPAID"
                          ? "text-yellow-300"
                          : "text-red-300"
                    }
                  >
                    {item.status} (${item.paidAmount.toFixed(2)} / ${item.expectedAmount.toFixed(2)})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Progress bar */}
      {allMonthBills.length > 0 && (
        <div className="space-y-2 surface-tech p-4 rounded-xl">
          <div className="progress-tech">
            <div
              className="progress-tech-fill"
              style={{ width: `${totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs font-mono text-muted-foreground">
              {allMonthBills.filter(isEffectivelyPaid).length} of {allMonthBills.length} paid
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction("markAllPaid")} className="h-7 font-mono text-xs text-muted-foreground hover:text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark All Paid
              </Button>
              <Button variant="ghost" size="sm" onClick={markAllUnpaid} disabled={isUndoingAll} className="h-7 font-mono text-xs text-muted-foreground hover:text-red-400">
                {isUndoingAll ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Circle className="h-3.5 w-3.5 mr-1.5" />}
                Undo All
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bill sections — shown FIRST so they're immediately visible */}
      {allMonthBills.length === 0 ? (
        <Card className="border-dashed border-2 border-cyan-500/25 bg-card/30 backdrop-blur-md">
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
                <Button variant="warning" size="sm" onClick={() => setConfirmAction("fix")} disabled={isRunningBulk} className="font-mono text-xs uppercase">
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
          <Card className="surface-tech overflow-hidden">
            <div className="border-b border-cyan-500/15">
              <SectionHeader
                title="Monthly Recurring"
                count={recurringBills.length}
                total={recurringBills.reduce((s, b) => s + b.amount, 0)}
                paidTotal={recurringBills.filter(isEffectivelyPaid).reduce((s, b) => s + b.amount, 0)}
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
                  {recurringBills.map((b) => <BillRow key={b.id} bill={b} ledgerLinked={ledgerLinkedMap.get(b.id)} {...billRowProps} />)}
                </div>
              )
            )}
          </Card>

          {/* SECTION 2: Month-Specific */}
          <Card className="surface-tech overflow-hidden">
            <div className="border-b border-cyan-500/15">
              <SectionHeader
                title={`This Month Only — ${selectedMonth}`}
                count={monthSpecificBills.length}
                total={monthSpecificBills.reduce((s, b) => s + b.amount, 0)}
                paidTotal={monthSpecificBills.filter(isEffectivelyPaid).reduce((s, b) => s + b.amount, 0)}
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
                  {monthSpecificBills.map((b) => <BillRow key={b.id} bill={b} ledgerLinked={ledgerLinkedMap.get(b.id)} {...billRowProps} />)}
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
            const wPaid = wBills.filter(isEffectivelyPaid).reduce((s, b) => s + b.amount, 0);
            return (
              <Card key={label} className={`surface-tech border-2 ${color} backdrop-blur-xl`}>
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
                      {wBills.map((b) => <BillRow key={b.id} bill={b} compact ledgerLinked={ledgerLinkedMap.get(b.id)} {...billRowProps} />)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirm: Mark All Paid */}
      <Dialog open={confirmAction === "markAllPaid"} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[400px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-green-400 tracking-wider text-sm">Mark All Bills Paid?</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-mono text-muted-foreground">
            This will mark <span className="text-primary">{allMonthBills.filter((b) => !isEffectivelyPaid(b)).length} unpaid bill{allMonthBills.filter((b) => !isEffectivelyPaid(b)).length !== 1 ? "s" : ""}</span> as paid for {selectedMonth} and add a matching transaction to your Ledger for each one.
          </p>
          <p className="text-xs font-mono text-muted-foreground/70 mt-1">
            You can undo this anytime with the <span className="text-red-400">Undo All</span> button — it removes the paid status and deletes the auto-added Ledger entries.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button variant="success" onClick={markAllPaid} disabled={isMarkingAllPaid} className="font-mono text-xs uppercase">
              {isMarkingAllPaid ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {isMarkingAllPaid ? "Saving..." : "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
            <Button variant="warning" onClick={handleFixBillTypes} disabled={isRunningBulk} className="font-mono text-xs uppercase">
              {isRunningBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wrench className="w-4 h-4 mr-2" />}
              Fix Now
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate Bill Cleanup Dialog */}
      <Dialog open={duplicateBillsOpen} onOpenChange={setDuplicateBillsOpen}>
        <DialogContent className="sm:max-w-[620px] bg-card border-border max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-yellow-400 tracking-wider text-sm">Duplicate Bills</DialogTitle>
          </DialogHeader>
          <p className="text-xs font-mono text-muted-foreground">
            Found <span className="text-yellow-400">{allDuplicateBillGroups.length}</span> duplicate bill group{allDuplicateBillGroups.length !== 1 ? "s" : ""}.
            One bill is kept in each group; selected extra records will be deleted from Bill Manager only.
          </p>
          <div className="space-y-3 py-2">
            {allDuplicateBillGroups.map((group) => (
              <div key={group.id} className="border border-yellow-500/20 rounded-md p-3 bg-yellow-500/5">
                <p className="font-mono text-xs text-yellow-400 uppercase tracking-wider mb-2">
                  {group.bills.length} copies • ${group.bills[0]?.amount.toFixed(2)}
                </p>
                <div className="space-y-1">
                  {group.bills.map((bill) => {
                    const isKept = bill.id === group.keepId;
                    const checked = selectedDuplicateBillIds.has(bill.id);
                    return (
                      <div key={bill.id} className={`flex items-center justify-between gap-3 text-xs font-mono ${isKept ? "text-foreground" : "text-muted-foreground"}`}>
                        <label className="flex min-w-0 items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!isKept && checked}
                            disabled={isKept}
                            onChange={(e) => {
                              const next = new Set(selectedDuplicateBillIds);
                              if (e.target.checked) next.add(bill.id);
                              else next.delete(bill.id);
                              setSelectedDuplicateBillIds(next);
                            }}
                          />
                          <span className="truncate">{bill.name}</span>
                        </label>
                        <span className="shrink-0 text-right">
                          Day {bill.dueDay} • {bill.isRecurring ? "recurring" : bill.month || "month-only"} • {isKept ? "keep" : "duplicate"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={() => setDuplicateBillsOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button
              onClick={handleRemoveDuplicateBills}
              disabled={removingDuplicateBills || selectedDuplicateBillIds.size === 0}
              variant="warning"
              className="font-mono text-xs uppercase"
            >
              {removingDuplicateBills ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Remove Selected ({selectedDuplicateBillIds.size})
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
              className="font-mono text-xs uppercase"
            >
              {isRunningBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanSearch className="w-4 h-4 mr-2" />}
              Clear &amp; Re-detect
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm: Month Audit */}
      <Dialog open={confirmAction === "monthAudit"} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[450px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase text-orange-300 tracking-wider text-sm">Apply Month Cleanup?</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-mono text-muted-foreground">
            This scans {selectedMonth} for likely duplicate spend rows and removes duplicate copies, then recalculates totals.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="font-mono text-xs uppercase">Cancel</Button>
            <Button variant="warning" onClick={runMonthAuditCleanup} disabled={isRunningBulk} className="font-mono text-xs uppercase">
              {isRunningBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Apply Cleanup
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
      <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) { setFormData(BLANK_FORM); setEditingId(null); setEditingBill(null); } }}>
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
              {addingCustomCat ? (
                <div className="flex gap-1">
                  <Input
                    autoFocus
                    placeholder="New category name"
                    value={newCustomCatInput}
                    onChange={(e) => setNewCustomCatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const trimmed = newCustomCatInput.trim();
                        if (trimmed && !allCategories.includes(trimmed)) {
                          saveCustomCats.mutate([...(customCats || []), trimmed]);
                        }
                        if (trimmed) setFormData({ ...formData, category: trimmed as any });
                        setNewCustomCatInput(""); setAddingCustomCat(false);
                      }
                      if (e.key === "Escape") setAddingCustomCat(false);
                    }}
                    className="font-mono bg-input border-border text-sm h-9"
                  />
                  <Button size="sm" className="h-9 px-2" onClick={() => {
                    const trimmed = newCustomCatInput.trim();
                    if (trimmed && !allCategories.includes(trimmed)) saveCustomCats.mutate([...(customCats || []), trimmed]);
                    if (trimmed) setFormData({ ...formData, category: trimmed as any });
                    setNewCustomCatInput(""); setAddingCustomCat(false);
                  }}><PlusCircle className="w-4 h-4" /></Button>
                  <Button size="sm" variant="ghost" className="h-9 px-2" onClick={() => setAddingCustomCat(false)}><X className="w-4 h-4" /></Button>
                </div>
              ) : (
                <Select value={formData.category} onValueChange={(v: any) => {
                  if (v === "__add__") { setAddingCustomCat(true); }
                  else { setFormData({ ...formData, category: v }); }
                }}>
                  <SelectTrigger className="font-mono bg-input border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    <SelectItem value="__add__" className="text-primary font-mono text-xs border-t border-border mt-1 pt-1">+ Add custom category...</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-mono">Monthly Recurring</p>
                <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{formData.isRecurring ? "Shows every month" : `Only for ${selectedMonth}`}</p>
              </div>
              <Switch checked={formData.isRecurring} onCheckedChange={(v) => setFormData({ ...formData, isRecurring: v })} />
            </div>
          </div>
          {(() => {
            const liveBill = editingId ? allMonthBills.find((b) => b.id === editingId) : null;
            const isManuallyPaid = liveBill ? isPaidInMonth(liveBill, selectedMonth) : false;
            return (
              <div className="flex justify-between gap-2 flex-wrap">
                {isManuallyPaid && (
                  <Button
                    variant="outline"
                    disabled={isTogglingUnpaid}
                    onClick={async () => {
                      if (!liveBill) return;
                      setIsTogglingUnpaid(true);
                      try {
                        await togglePaid(liveBill);
                      } finally {
                        setIsTogglingUnpaid(false);
                        setIsDialogOpen(false);
                        setFormData(BLANK_FORM);
                        setEditingId(null);
                        setEditingBill(null);
                      }
                    }}
                    className="font-mono text-xs uppercase text-red-400 border-red-500/40 hover:bg-red-500/10"
                  >
                    {isTogglingUnpaid ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Circle className="w-3.5 h-3.5 mr-1.5" />}
                    Mark Unpaid
                  </Button>
                )}
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="font-mono text-xs uppercase">Cancel</Button>
                  <Button onClick={handleSave} disabled={addBill.isPending || updateBill.isPending} className="font-mono text-xs uppercase">
                    {(addBill.isPending || updateBill.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {editingId ? "Update" : "Add"}
                  </Button>
                </div>
              </div>
            );
          })()}
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
                className="font-mono text-xs bg-input border-border min-h-[280px] resize-y"
                placeholder={"Vehicle:\n03/11 — Wells Fargo Auto Loan: $181.39\n03/23 — Oklahoma Motor Credit: $290.00\n\nSubscriptions:\n03/12 — ChatGPT: $21.19\n03/17 — Planet Fitness: $21.75\n\nMedical Bills:\n03/17 — Integris: $50.00"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                autoFocus
              />
              <div className="flex justify-between items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setParsedBills([{ name: "", amount: 0, dueDay: 1, category: "Bills" as TransactionCategory, isRecurring: true }])}
                  className="font-mono text-xs text-muted-foreground hover:text-primary"
                >
                  <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Manual Entry
                </Button>
                <div className="flex gap-2">
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
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-mono text-green-400">{parsedBills.length} bill{parsedBills.length !== 1 ? "s" : ""} — edit name, amount, due day, category, or recurring below. Trash icon removes the entry.</p>
              <div className="divide-y divide-border border border-border rounded overflow-hidden max-h-[420px] overflow-y-auto">
                {parsedBills.map((b, i) => (
                  <div key={i} className="p-3 space-y-2 bg-card hover:bg-muted/10 transition-colors">
                    {/* Row 1 — Name + Amount + Delete */}
                    <div className="flex items-center gap-2">
                      <Input
                        value={b.name}
                        placeholder="Bill name"
                        onChange={(e) => setParsedBills((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                        className="flex-1 font-mono text-xs h-7 bg-input border-border px-2"
                      />
                      <div className="relative w-24 flex-shrink-0">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-mono pointer-events-none">$</span>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={b.amount}
                          onChange={(e) => setParsedBills((prev) => prev.map((x, idx) => idx === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))}
                          className="font-mono text-xs h-7 bg-input border-border pl-5 pr-2"
                        />
                      </div>
                      <button
                        onClick={() => setParsedBills((prev) => prev.filter((_, idx) => idx !== i))}
                        className="flex-shrink-0 p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Remove this bill"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Row 2 — Due Day + Category + Recurring */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase whitespace-nowrap">Day</span>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={b.dueDay}
                          onChange={(e) => setParsedBills((prev) => prev.map((x, idx) => idx === i ? { ...x, dueDay: parseInt(e.target.value) || 1 } : x))}
                          className="w-14 font-mono text-xs h-7 bg-input border-border px-2 text-center"
                        />
                      </div>
                      <Select
                        value={b.category}
                        onValueChange={(v) => setParsedBills((prev) => prev.map((x, idx) => idx === i ? { ...x, category: v as TransactionCategory } : x))}
                      >
                        <SelectTrigger className="h-7 font-mono text-xs flex-1 bg-input border-border min-w-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {allCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase whitespace-nowrap">Monthly</span>
                        <Switch
                          checked={b.isRecurring}
                          onCheckedChange={(v) => setParsedBills((prev) => prev.map((x, idx) => idx === i ? { ...x, isRecurring: v } : x))}
                          className="scale-[0.75] origin-right"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-1">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setParsedBills([])} className="font-mono text-xs uppercase text-muted-foreground">
                    Back to Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setParsedBills((prev) => [...prev, { name: "", amount: 0, dueDay: 1, category: "Bills" as TransactionCategory, isRecurring: true }])}
                    className="font-mono text-xs text-primary hover:bg-primary/10"
                  >
                    <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Add Row
                  </Button>
                </div>
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
