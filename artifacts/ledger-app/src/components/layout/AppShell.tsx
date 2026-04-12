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
} from "lucide-react";
import { useMonths } from "@/hooks/use-finance";
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
import { useEffect, useMemo } from "react";

function buildMonthOptions(existingMonths: string[], currentKey: string): string[] {
  const keys = new Set<string>(existingMonths);
  keys.add(currentKey);
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.add(getMonthKey(d));
  }
  return Array.from(keys).sort((a, b) => b.localeCompare(a));
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home",   fullLabel: "Overview",   icon: LayoutDashboard },
  { href: "/ledger",    label: "Ledger", fullLabel: "Ledger",     icon: ListTodo },
  { href: "/bills",     label: "Bills",  fullLabel: "Bills",      icon: Receipt },
  { href: "/import",    label: "Import", fullLabel: "Import",     icon: Upload },
  { href: "/analytics", label: "Stats", fullLabel: "Analytics",  icon: BarChart2 },
  { href: "/rules",     label: "Rules",  fullLabel: "Rules",      icon: Settings2 },
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

  return (
    <div className="flex h-screen text-foreground overflow-hidden flex-col md:flex-row">
      {/* ── Sidebar (Desktop) ── */}
      <aside className="hidden md:flex w-64 flex-col glass shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-white/5">
          <h1 className="font-display text-lg font-bold tracking-widest text-primary uppercase select-none"
            style={{ textShadow: '0 0 20px rgba(56,155,255,0.5)' }}>
            LEDGER.
          </h1>
          <p className="text-[9px] font-mono tracking-[0.3em] text-muted-foreground/60 mt-0.5 uppercase">
            Financial Terminal
          </p>
        </div>

        {/* Month selector */}
        <div className="px-4 py-4 border-b border-white/5">
          <Select value={currentMonthKey} onValueChange={onMonthChange}>
            <SelectTrigger className="w-full bg-white/5 border-white/10 font-mono text-xs hover:bg-white/8 transition-colors">
              <CalendarDays className="w-3.5 h-3.5 mr-2 text-primary/70" />
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((key) => (
                <SelectItem key={key} value={key} className="font-mono text-xs">
                  {formatMonthLabel(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all text-sm font-medium group ${
                  isActive
                    ? "nav-item-active text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                }`}
              >
                <Icon className={`w-4 h-4 transition-all ${isActive ? "text-primary drop-shadow-[0_0_6px_rgba(56,155,255,0.7)]" : "group-hover:text-foreground"}`} />
                <span className={`font-mono text-xs uppercase tracking-wider ${isActive ? "text-primary" : ""}`}>
                  {item.fullLabel}
                </span>
                {isActive && (
                  <span className="ml-auto w-1 h-4 rounded-full bg-primary" style={{ boxShadow: '0 0 6px rgba(56,155,255,0.8)' }} />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center text-xs font-mono font-bold text-primary"
              style={{ boxShadow: '0 0 10px rgba(56,155,255,0.15)' }}>
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono text-muted-foreground truncate">{user?.email}</p>
              <p className="text-[9px] font-mono text-primary/40 uppercase tracking-wider">Authenticated</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground hover:text-destructive transition-colors w-full px-2 py-1.5 rounded-md hover:bg-destructive/10 uppercase tracking-wider"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0 relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-3 py-2.5 glass-bar border-b border-white/5 sticky top-0 z-40">
          <h1 className="font-display text-sm font-bold tracking-widest text-primary uppercase shrink-0 select-none"
            style={{ textShadow: '0 0 16px rgba(56,155,255,0.5)' }}>
            LEDGER.
          </h1>
          <div className="flex items-center gap-2 ml-2">
            <Select value={currentMonthKey} onValueChange={onMonthChange}>
              <SelectTrigger className="w-[130px] h-8 bg-white/5 border-white/10 font-mono text-xs">
                <SelectValue placeholder="Select Month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((key) => (
                  <SelectItem key={key} value={key} className="font-mono text-xs">
                    {formatMonthLabel(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-8 h-8 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center text-xs font-mono font-bold text-primary shrink-0"
                  style={{ boxShadow: '0 0 10px rgba(56,155,255,0.15)' }}>
                  {user?.email?.charAt(0).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 bg-card/90 backdrop-blur-md border-white/10">
                <div className="px-2 py-1.5">
                  <p className="text-[11px] text-muted-foreground font-mono truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-white/5" />
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="text-destructive focus:text-destructive gap-2 cursor-pointer font-medium font-mono text-xs uppercase tracking-wider"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* ── Bottom Nav (Mobile) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[58px] glass-bar flex items-center justify-around z-50">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-[3px] transition-all ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className={`w-[18px] h-[18px] ${isActive ? "drop-shadow-[0_0_6px_rgba(56,155,255,0.8)]" : ""}`} />
              <span className={`text-[9px] font-mono uppercase tracking-wider leading-none ${isActive ? "text-primary" : ""}`}>
                {item.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 w-8 h-0.5 rounded-full bg-primary"
                  style={{ boxShadow: '0 0 8px rgba(56,155,255,0.8)' }} />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
