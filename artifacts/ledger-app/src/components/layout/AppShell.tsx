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
  { href: "/dashboard", label: "Home",     fullLabel: "Overview",   icon: LayoutDashboard },
  { href: "/ledger",    label: "Ledger",   fullLabel: "Ledger",     icon: ListTodo },
  { href: "/bills",     label: "Bills",    fullLabel: "Bills",      icon: Receipt },
  { href: "/import",    label: "Import",   fullLabel: "Import",     icon: Upload },
  { href: "/analytics", label: "Stats",   fullLabel: "Analytics",  icon: BarChart2 },
  { href: "/rules",     label: "Rules",    fullLabel: "Rules",      icon: Settings2 },
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
    <div className="flex h-screen bg-background text-foreground overflow-hidden flex-col md:flex-row">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 flex-col border-r border-border bg-card">
        <div className="p-6">
          <h1 className="text-xl font-bold tracking-tight text-primary font-mono uppercase">
            Ledger.
          </h1>
        </div>

        <div className="px-4 mb-6">
          <Select value={currentMonthKey} onValueChange={onMonthChange}>
            <SelectTrigger className="w-full bg-input border-border font-mono text-sm">
              <CalendarDays className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((key) => (
                <SelectItem key={key} value={key}>
                  {formatMonthLabel(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.fullLabel}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-mono">
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive transition-colors w-full p-2 rounded-md hover:bg-secondary"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between px-3 py-2.5 border-b border-border bg-card">
          <h1 className="text-base font-bold tracking-tight text-primary font-mono uppercase shrink-0">
            Ledger.
          </h1>
          <div className="flex items-center gap-2 ml-2">
            <Select value={currentMonthKey} onValueChange={onMonthChange}>
              <SelectTrigger className="w-[130px] h-8 bg-input border-border font-mono text-xs">
                <SelectValue placeholder="Select Month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((key) => (
                  <SelectItem key={key} value={key}>
                    {formatMonthLabel(key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* User / Logout button — mobile only */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-mono font-bold shrink-0 border border-border">
                  {user?.email?.charAt(0).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 bg-card border-border">
                <div className="px-2 py-1.5">
                  <p className="text-[11px] text-muted-foreground font-mono truncate">{user?.email}</p>
                </div>
                <DropdownMenuSeparator />
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

        <div className="p-4 md:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Bottom Nav (Mobile) — 6 items, icon + short label */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[58px] border-t border-border bg-card flex items-center justify-around z-50">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-[3px] ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="w-[18px] h-[18px]" />
              <span className="text-[9px] font-medium leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
