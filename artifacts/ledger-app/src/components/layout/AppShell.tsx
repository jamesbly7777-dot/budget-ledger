import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  ListTodo,
  Receipt,
  Upload,
  BarChart2,
  Settings2,
  LogOut,
  CalendarDays,
  Wallet,
  RefreshCw,
} from "lucide-react";
import { useMonths, useTransactions, useBills } from "@/hooks/use-finance";
import {
  computeAuditedMonthTotals,
  computeBillManagerMonthTotals,
  filterTransactionsToCalendarMonth,
} from "@/lib/billStatus";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getMonthKey, formatMonthLabel } from "@/lib/rulesEngine";
import { buildMonthOptions } from "@/lib/monthNav";
import { useEffect, useMemo } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", fullLabel: "Overview", icon: LayoutDashboard },
  { href: "/ledger", label: "Ledger", fullLabel: "Ledger", icon: ListTodo },
  { href: "/bills", label: "Bills", fullLabel: "Bills", icon: Receipt },
  { href: "/import", label: "Import", fullLabel: "Import", icon: Upload },
  { href: "/analytics", label: "Stats", fullLabel: "Analytics", icon: BarChart2 },
  { href: "/rules", label: "Rules", fullLabel: "Rules", icon: Settings2 },
];

interface AppShellProps {
  children: React.ReactNode;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}

export function AppShell({ children, selectedMonth, onMonthChange }: AppShellProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { data: months } = useMonths();

  useEffect(() => {
    if (selectedMonth) return;
    if (months === undefined) return;
    const sorted = [...(months ?? [])].sort((a, b) => b.month.localeCompare(a.month));
    const latestDataMonth = sorted[0]?.month;
    onMonthChange(latestDataMonth ?? getMonthKey(new Date()));
  }, [selectedMonth, months, onMonthChange]);

  const currentMonthKey = selectedMonth || getMonthKey(new Date());
  const monthOptions = useMemo(
    () => buildMonthOptions(months?.map((m) => m.month) ?? [], currentMonthKey),
    [months, currentMonthKey]
  );

  const { data: txs } = useTransactions(currentMonthKey);
  const { data: bills } = useBills();

  const headerStats = useMemo(() => {
    if (!txs) return { balance: null as number | null, due: null as number | null };
    const scoped = filterTransactionsToCalendarMonth(txs, currentMonthKey);
    const { income, spending: expenses } = computeAuditedMonthTotals(scoped);
    const balance = income - expenses;
    const due = computeBillManagerMonthTotals(bills || [], currentMonthKey, scoped).remainingAmount;
    return { balance, due };
  }, [txs, bills, currentMonthKey]);

  const fmtMoney = (n: number | null) => {
    if (n === null || Number.isNaN(n)) return "—";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="flex min-h-screen text-foreground overflow-hidden flex-col md:flex-row">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-[272px] flex-col border-r border-cyan-500/15 bg-sidebar/80 backdrop-blur-2xl relative">
        <div
          className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-cyan-400/35 to-transparent pointer-events-none"
          aria-hidden
        />
        <div className="p-6 pb-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_hsl(187_100%_50%_/_.8)] animate-pulse" />
            <h1 className="font-display text-xl font-bold tracking-[0.28em] uppercase text-glow-cyan">
              LEDGER AI
            </h1>
          </div>
          <p className="mt-1.5 text-[10px] font-mono uppercase tracking-[0.35em] text-muted-foreground/90">
            Neural finance core
          </p>
        </div>

        <div className="px-4 mb-5">
          <Select value={currentMonthKey} onValueChange={onMonthChange}>
            <SelectTrigger className="w-full border-cyan-500/25 bg-input/60 font-mono text-sm backdrop-blur-md shadow-[0_0_20px_-8px_hsl(187_100%_50%_/_.25)]">
              <CalendarDays className="w-4 h-4 mr-2 text-primary" />
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent className="border-cyan-500/20 bg-popover/95 backdrop-blur-xl">
              {monthOptions.map((key) => (
                <SelectItem key={key} value={key} className="font-mono text-xs">
                  {formatMonthLabel(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border border-transparent ${
                  isActive
                    ? "bg-primary/12 text-primary nav-glow-active border-cyan-500/20"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground hover:border-cyan-500/10"
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                <span className="font-mono text-xs uppercase tracking-wider">{item.fullLabel}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-cyan-500/10 bg-black/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/25 to-violet-500/20 border border-cyan-500/25 flex items-center justify-center text-xs font-mono font-bold text-primary shadow-[0_0_16px_-4px_hsl(187_100%_50%_/_.4)]">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Operator</p>
              <p className="text-xs font-medium truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-colors w-full p-2.5 rounded-lg hover:bg-destructive/10 border border-transparent hover:border-destructive/20 font-mono uppercase tracking-wider"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0 min-h-0 flex flex-col">
        <header className="md:hidden flex items-center justify-between px-3 py-3 border-b border-cyan-500/15 bg-card/40 backdrop-blur-xl">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0 shadow-[0_0_8px_hsl(187_100%_50%)]" />
            <h1 className="font-display text-sm font-bold tracking-[0.12em] uppercase text-primary truncate">
              LEDGER AI
            </h1>
          </div>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            <Select value={currentMonthKey} onValueChange={onMonthChange}>
              <SelectTrigger className="w-[124px] h-8 border-cyan-500/25 bg-input/70 font-mono text-[10px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent className="border-cyan-500/20 bg-popover/95 backdrop-blur-xl">
                {monthOptions.map((key) => (
                  <SelectItem key={key} value={key} className="font-mono text-xs">
                    {formatMonthLabel(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-8 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-violet-500/15 flex items-center justify-center text-[10px] font-mono font-bold border border-cyan-500/30">
                  {user?.email?.charAt(0).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 border-cyan-500/20 bg-popover/95 backdrop-blur-xl">
                <div className="px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground font-mono truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-cyan-500/10" />
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="text-destructive focus:text-destructive gap-2 cursor-pointer font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="shrink-0 border-b border-cyan-500/20 bg-black/30 backdrop-blur-xl px-4 py-3 md:px-8">
          <div className="max-w-7xl mx-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                asChild
                variant="default"
                size="sm"
                className="font-mono text-xs uppercase tracking-wider min-h-9"
              >
                <Link href="/ledger" className="inline-flex items-center gap-2">
                  <Wallet className="h-4 w-4 shrink-0" aria-hidden />
                  Add Transaction
                </Link>
              </Button>
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="font-mono text-xs uppercase tracking-wider min-h-9 text-white"
              >
                <Link href="/bills" className="inline-flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
                  Fix Recurring
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs sm:text-sm">
              <span className="text-zinc-300">
                Balance:{" "}
                <span className="font-semibold text-emerald-400 tabular-nums [text-shadow:0_0_10px_hsl(150_90%_45%_/_.45)]">
                  ${fmtMoney(headerStats.balance)}
                </span>
              </span>
              <span className="text-zinc-300">
                Due:{" "}
                <span className="font-semibold text-red-400 tabular-nums [text-shadow:0_0_10px_hsl(0_90%_55%_/_.4)]">
                  ${fmtMoney(headerStats.due)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-8 max-w-7xl mx-auto w-full flex-1">{children}</div>
      </main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-[100] flex min-h-[calc(60px+env(safe-area-inset-bottom,0px))] items-stretch justify-around border-t border-cyan-500/20 bg-card/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-2xl shadow-[0_-8px_32px_-8px_hsl(230_80%_2%_/_.6)]">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[52px] flex-1 touch-manipulation cursor-pointer flex-col items-center justify-center gap-0.5 transition-colors select-none active:opacity-90 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className={`w-[18px] h-[18px] ${isActive ? "drop-shadow-[0_0_10px_hsl(190_100%_52%_/_.55)]" : ""}`} />
              <span
                className={`text-[9px] font-mono font-semibold uppercase tracking-tight leading-none max-w-[56px] truncate ${
                  isActive ? "text-white [text-shadow:0_0_6px_hsl(190_100%_50%_/_.4)]" : "text-zinc-400"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
