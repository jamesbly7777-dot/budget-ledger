import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as service from "@/lib/firestoreService";
import { useAuth } from "@/contexts/AuthContext";
import { Transaction, Bill, Month, Rule } from "@/lib/types";

export function useTransactions(month?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transactions", user?.uid, month],
    queryFn: () => service.getTransactions(user!.uid, month),
    enabled: !!user,
  });
}

export function useAddTransaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tx: Omit<Transaction, "id" | "createdAt" | "updatedAt">) => service.addTransaction(user!.uid, tx),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", user?.uid] });
      queryClient.invalidateQueries({ queryKey: ["months", user?.uid] });
    },
  });
}

export function useDeleteTransaction() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => service.deleteTransaction(user!.uid, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", user?.uid] });
      queryClient.invalidateQueries({ queryKey: ["months", user?.uid] });
    },
  });
}

export function useBulkAddTransactions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (txs: Omit<Transaction, "id" | "createdAt" | "updatedAt">[]) => service.bulkAddTransactions(user!.uid, txs),
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
  return useQuery({
    queryKey: ["bills", user?.uid, month],
    queryFn: () => service.getBills(user!.uid, month),
    enabled: !!user,
  });
}

export function useAddBill() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bill: Omit<Bill, "id" | "createdAt" | "updatedAt">) => service.addBill(user!.uid, bill),
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
