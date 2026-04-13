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
  {
    href: "/dashboard",
    label: "Home",
    fullLabel: "Overview",
    icon: LayoutDashboard,
    iconBg: "#f97316",
    iconGlow: "rgba(249,115,22,0.45)",
    activeGlow: "rgba(249,115,22,0.18)",
  },
  {
    href: "/ledger",
    label: "Ledger",
    fullLabel: "Ledger",
    icon: ListTodo,
    iconBg: "#3b82f6",
    iconGlow: "rgba(59,130,246,0.45)",
    activeGlow: "rgba(59,130,246,0.18)",
  },
  {
    href: "/bills",
    label: "Bills",
    fullLabel: "Bills",
    icon: Receipt,
    iconBg: "#14b8a6",
    iconGlow: "rgba(20,184,166,0.45)",
    activeGlow: "rgba(20,184,166,0.18)",
  },
  {
    href: "/import",
    label: "Import",
    fullLabel: "Import",
    icon: Upload,
    iconBg: "#6366f1",
    iconGlow: "rgba(99,102,241,0.45)",
    activeGlow: "rgba(99,102,241,0.18)",
  },
  {
    href: "/analytics",
    label: "Stats",
    fullLabel: "Analytics",
    icon: BarChart2,
    iconBg: "#f59e0b",
    iconGlow: "rgba(245,158,11,0.45)",
    activeGlow: "rgba(245,158,11,0.18)",
  },
  {
    href: "/rules",
    label: "Rules",
    fullLabel: "Rules",
    icon: Settings2,
    iconBg: "#ec4899",
    iconGlow: "rgba(236,72,153,0.45)",
    activeGlow: "rgba(236,72,153,0.18)",
  },
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
          <h1
            className="font-display text-xl font-black tracking-widest text-white uppercase select-none"
            style={{ textShadow: "0 0 28px rgba(56,155,255,0.7), 0 0 60px rgba(56,155,255,0.3)" }}
          >
            LEDGER<span style={{ color: "#f97316", textShadow: "0 0 20px rgba(249,115,22,0.8)" }}>.</span>AI
          </h1>
          <p className="text-[9px] font-mono tracking-[0.3em] text-muted-foreground/60 mt-0.5 uppercase">
            Financial Intelligence
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
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium group relative ${
                  isActive ? "text-white" : "text-muted-foreground hover:text-foreground"
                }`}
                style={
                  isActive
                    ? {
                        background: `linear-gradient(135deg, ${item.iconBg}22 0%, ${item.iconBg}11 100%)`,
                        boxShadow: `inset 0 0 0 1px ${item.iconBg}44, 0 0 20px ${item.iconBg}22`,
                      }
                    : {}
                }
              >
                {/* Colored icon badge */}
                <span
                  className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-all"
                  style={{
                    background: isActive ? item.iconBg : `${item.iconBg}22`,
                    boxShadow: isActive ? `0 0 16px ${item.iconGlow}` : "none",
                  }}
                >
                  <Icon
                    className="w-4 h-4"
                    style={{ color: isActive ? "#fff" : item.iconBg }}
                  />
                </span>

                <span className="font-mono text-xs uppercase tracking-wider font-semibold">
                  {item.fullLabel}
                </span>

                {isActive && (
                  <span
                    className="ml-auto w-1.5 h-5 rounded-full"
                    style={{
                      background: item.iconBg,
                      boxShadow: `0 0 10px ${item.iconGlow}`,
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold text-white shrink-0"
              style={{
                background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
                boxShadow: "0 0 14px rgba(59,130,246,0.4)",
              }}
            >
              {user?.email?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono text-foreground/70 truncate">{user?.email}</p>
              <p className="text-[9px] font-mono text-primary/50 uppercase tracking-wider">Connected</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground hover:text-red-400 transition-colors w-full px-2 py-1.5 rounded-md hover:bg-red-500/10 uppercase tracking-wider"
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
          <h1
            className="font-display text-sm font-black tracking-widest text-white uppercase shrink-0 select-none"
            style={{ textShadow: "0 0 20px rgba(56,155,255,0.6)" }}
          >
            LEDGER<span style={{ color: "#f97316" }}>.</span>AI
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
                <button
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold text-white shrink-0"
                  style={{
                    background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
                    boxShadow: "0 0 12px rgba(59,130,246,0.35)",
                  }}
                >
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-[60px] glass-bar flex items-center justify-around z-50 px-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center justify-center flex-1 h-full gap-[3px] transition-all relative"
            >
              <span
                className="w-8 h-7 rounded-md flex items-center justify-center transition-all"
                style={{
                  background: isActive ? item.iconBg : "transparent",
                  boxShadow: isActive ? `0 0 14px ${item.iconGlow}` : "none",
                }}
              >
                <Icon
                  className="w-[16px] h-[16px]"
                  style={{ color: isActive ? "#fff" : item.iconBg + "99" }}
                />
              </span>
              <span
                className="text-[8px] font-mono uppercase tracking-wider leading-none"
                style={{ color: isActive ? item.iconBg : undefined }}
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
