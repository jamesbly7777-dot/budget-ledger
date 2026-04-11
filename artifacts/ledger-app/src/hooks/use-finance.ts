import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as service from "@/lib/firestoreService";
import { useAuth } from "@/contexts/AuthContext";
import { Transaction, Bill, Month, Rule } from "@/lib/types";

export function useTransactions(month?: string) {
  const { user } = useAuth();
  const [data, setData] = useState<Transaction[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) { setData(undefined); setIsLoading(false); return; }
    setIsLoading(true);
    const unsubscribe = service.subscribeTransactions(user.uid, month, (txs) => {
      setData(txs);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [user?.uid, month]);

  return { data, isLoading, refetch: async () => {} };
}

export function useAddTransaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tx: Omit<Transaction, "id" | "createdAt" | "updatedAt" | "userId">) => service.addTransaction(user!.uid, tx as any),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["transactions", user?.uid] });
      queryClient.invalidateQueries({ queryKey: ["months", user?.uid] });
      service.recalculateMonthTotals(user!.uid, variables.month);
    },
  });
}

export function useUpdateTransaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Transaction> }) => service.updateTransaction(user!.uid, id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["transactions", user?.uid] });
      queryClient.invalidateQueries({ queryKey: ["months", user?.uid] });
      if (variables.data.month) service.recalculateMonthTotals(user!.uid, variables.data.month);
    },
  });
}

export function useDeleteTransaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, month }: { id: string; month: string }) => service.deleteTransaction(user!.uid, id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["transactions", user?.uid] });
      queryClient.invalidateQueries({ queryKey: ["months", user?.uid] });
      if (variables.month) service.recalculateMonthTotals(user!.uid, variables.month);
    },
  });
}

export function useBulkAddTransactions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (txs: Omit<Transaction, "id" | "createdAt" | "updatedAt" | "userId">[]) => service.bulkAddTransactions(user!.uid, txs as any),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["transactions", user?.uid] });
      queryClient.invalidateQueries({ queryKey: ["months", user?.uid] });
      // Recalculate totals for all affected months
      const months = Array.from(new Set(variables.map((t) => t.month)));
      months.forEach((m) => service.recalculateMonthTotals(user!.uid, m));
    },
  });
}

export function useBills(month?: string) {
  const { user } = useAuth();
  const [data, setData] = useState<Bill[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) { setData(undefined); setIsLoading(false); return; }
    setIsLoading(true);
    const unsubscribe = service.subscribeBills(user.uid, (allBills) => {
      const filtered = month
        ? allBills.filter((b) => !b.month || b.month === month)
        : allBills;
      setData(filtered);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [user?.uid, month]);

  return { data, isLoading, refetch: async () => {} };
}

export function useAddBill() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bill: Omit<Bill, "id" | "createdAt" | "updatedAt" | "userId">) => service.addBill(user!.uid, bill as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills", user?.uid] });
    },
  });
}

export function useUpdateBill() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Bill> }) => service.updateBill(user!.uid, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills", user?.uid] });
    },
  });
}

export function useDeleteBill() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => service.deleteBill(user!.uid, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills", user?.uid] });
    },
  });
}

export function useMonths() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["months", user?.uid],
    queryFn: () => service.getMonths(user!.uid),
    enabled: !!user,
  });
}

export function useRules() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rules", user?.uid],
    queryFn: () => service.getRules(user!.uid),
    enabled: !!user,
  });
}

export function useAddRule() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rule: Omit<Rule, "id" | "createdAt" | "updatedAt">) => service.addRule(user!.uid, rule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", user?.uid] });
    },
  });
}

export function useUpdateRule() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Rule> }) => service.updateRule(user!.uid, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", user?.uid] });
    },
  });
}

export function useDeleteRule() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => service.deleteRule(user!.uid, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules", user?.uid] });
    },
  });
}

export function useReapplyRules() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rules, month }: { rules: Rule[]; month?: string }) =>
      service.reapplyRulesToTransactions(user!.uid, rules, month),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", user?.uid] });
      queryClient.invalidateQueries({ queryKey: ["months", user?.uid] });
    },
  });
}

export function useCustomCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["customCategories", user?.uid],
    queryFn: () => service.getCustomCategories(user!.uid),
    enabled: !!user,
    staleTime: 60_000,
  });
}

export function useSaveCustomCategories() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categories: string[]) => service.saveCustomCategories(user!.uid, categories),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customCategories", user?.uid] });
    },
  });
}
