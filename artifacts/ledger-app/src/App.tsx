import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { useState } from "react";

import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth";
import DashboardPage from "@/pages/dashboard";
import LedgerPage from "@/pages/ledger";
import BillsPage from "@/pages/bills";
import ImportPage from "@/pages/import";
import AnalyticsPage from "@/pages/analytics";
import RulesPage from "@/pages/rules";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedApp() {
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  return (
    <ProtectedRoute>
      <AppShell selectedMonth={selectedMonth} onMonthChange={setSelectedMonth}>
        <Switch>
          <Route path="/dashboard">
            <DashboardPage selectedMonth={selectedMonth} />
          </Route>
          <Route path="/ledger">
            <LedgerPage selectedMonth={selectedMonth} />
          </Route>
          <Route path="/bills">
            <BillsPage selectedMonth={selectedMonth} />
          </Route>
          <Route path="/import">
            <ImportPage selectedMonth={selectedMonth} />
          </Route>
          <Route path="/analytics">
            <AnalyticsPage selectedMonth={selectedMonth} />
          </Route>
          <Route path="/rules">
            <RulesPage />
          </Route>
          <Route path="/">
            <Redirect to="/dashboard" />
          </Route>
          <Route component={NotFound} />
        </Switch>
      </AppShell>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
            <Switch>
              <Route path="/auth" component={AuthPage} />
              <Route path="/:rest*">
                <ProtectedApp />
              </Route>
            </Switch>
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
