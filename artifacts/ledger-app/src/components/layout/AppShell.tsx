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
import { getMonthKey, formatMonthLabel } from "@/lib/rulesEngine";
import { useEffect } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/ledger", label: "Ledger", icon: ListTodo },
  { href: "/bills", label: "Bills", icon: Receipt },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/rules", label: "Rules", icon: Settings2 },
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
    if (!selectedMonth) {
      onMonthChange(getMonthKey(new Date()));
    }
  }, [selectedMonth, onMonthChange]);

  const currentMonthKey = selectedMonth || getMonthKey(new Date());

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
              {months?.map((m) => (
                <SelectItem key={m.id} value={m.month}>
                  {formatMonthLabel(m.month)}
                </SelectItem>
              ))}
              {!months?.find((m) => m.month === currentMonthKey) && (
                <SelectItem value={currentMonthKey}>
                  {formatMonthLabel(currentMonthKey)}
                </SelectItem>
              )}
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
                {item.label}
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
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
          <h1 className="text-lg font-bold tracking-tight text-primary font-mono uppercase">
            Ledger.
          </h1>
          <Select value={currentMonthKey} onValueChange={onMonthChange}>
            <SelectTrigger className="w-[140px] h-8 bg-input border-border font-mono text-xs">
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent>
              {months?.map((m) => (
                <SelectItem key={m.id} value={m.month}>
                  {formatMonthLabel(m.month)}
                </SelectItem>
              ))}
              {!months?.find((m) => m.month === currentMonthKey) && (
                <SelectItem value={currentMonthKey}>
                  {formatMonthLabel(currentMonthKey)}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </header>
        <div className="p-4 md:p-8 max-w-7xl mx-auto h-full">
          {children}
        </div>
      </main>

      {/* Bottom Nav (Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 border-t border-border bg-card flex items-center justify-around px-2 z-50">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center w-full h-full gap-1 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
