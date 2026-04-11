import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
      retry: 1,
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
            <ErrorBoundary pageName="Dashboard">
              <DashboardPage selectedMonth={selectedMonth} />
            </ErrorBoundary>
          </Route>
          <Route path="/ledger">
            <ErrorBoundary pageName="Ledger">
              <LedgerPage selectedMonth={selectedMonth} />
            </ErrorBoundary>
          </Route>
          <Route path="/bills">
            <ErrorBoundary pageName="Bills">
              <BillsPage selectedMonth={selectedMonth} />
            </ErrorBoundary>
          </Route>
          <Route path="/import">
            <ErrorBoundary pageName="Import">
              <ImportPage selectedMonth={selectedMonth} onMonthChange={setSelectedMonth} />
            </ErrorBoundary>
          </Route>
          <Route path="/analytics">
            <ErrorBoundary pageName="Analytics">
              <AnalyticsPage selectedMonth={selectedMonth} />
            </ErrorBoundary>
          </Route>
          <Route path="/rules">
            <ErrorBoundary pageName="Rules">
              <RulesPage />
            </ErrorBoundary>
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
    <ErrorBoundary pageName="App">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "")}>
              <Switch>
                <Route path="/auth" component={AuthPage} />
                <Route>
                  <ProtectedApp />
                </Route>
              </Switch>
            </WouterRouter>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
