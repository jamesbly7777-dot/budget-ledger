import { getMonthKey } from "@/lib/rulesEngine";

/** Month keys for the nav dropdown (data months + rolling window), same logic as AppShell. */
export function buildMonthOptions(existingMonths: string[], currentKey: string): string[] {
  const keys = new Set<string>(existingMonths);
  keys.add(currentKey);
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.add(getMonthKey(d));
  }
  return Array.from(keys).sort((a, b) => b.localeCompare(a));
}
