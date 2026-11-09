import "server-only";
import type { FinancialGoal } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { getPnl, loadPeriod, sumBy } from "./reports";
import { computeMetrics, getMrr } from "./metrics";

export const GOAL_METRICS: { value: FinancialGoal["metric"]; label: string; unit: "money" | "count" | "percent"; lowerIsBetter?: boolean; help: string }[] = [
  { value: "REVENUE", label: "Revenue (invoiced)", unit: "money", help: "Net revenue excl. GST, accrual basis" },
  { value: "CASH_COLLECTED", label: "Cash collected", unit: "money", help: "Money received from clients" },
  { value: "NET_PROFIT", label: "Net profit", unit: "money", help: "Accrual net profit" },
  { value: "EXPENSE_LIMIT", label: "Expense cap", unit: "money", lowerIsBetter: true, help: "Total expenses should stay under target" },
  { value: "SERVICE_REVENUE", label: "Service revenue", unit: "money", help: "Revenue from one service (select it)" },
  { value: "NEW_CLIENTS", label: "New clients", unit: "count", help: "Clients acquired in the period" },
  { value: "CLIENT_RETENTION", label: "Client retention %", unit: "percent", help: "Retention vs previous period (target as %)" },
  { value: "MRR", label: "Monthly recurring revenue", unit: "money", help: "Current MRR from recurring invoices" },
  { value: "CUSTOM", label: "Custom (manual)", unit: "count", help: "Enter the actual value yourself" },
];

export type GoalProgress = { actual: number | null; ratio: number | null; reason?: string; onTrack: boolean | null };

export async function goalProgress(g: FinancialGoal): Promise<GoalProgress> {
  const range = { from: g.periodStart, to: g.periodEnd };
  const target = num(g.target);
  let actual: number | null = null;
  let reason: string | undefined;
  switch (g.metric) {
    case "REVENUE": actual = num((await getPnl(range)).revenue); break;
    case "CASH_COLLECTED": actual = num((await getPnl(range)).clientReceipts); break;
    case "NET_PROFIT": actual = num((await getPnl(range)).netProfit); break;
    case "EXPENSE_LIMIT": actual = num((await getPnl(range)).totalExpenses); break;
    case "SERVICE_REVENUE": {
      if (!g.serviceId) { reason = "No service selected."; break; }
      const { entries } = await loadPeriod(range);
      actual = num(sumBy(entries, (e) => e.serviceId, (e) => e.bucket === "REVENUE").get(g.serviceId) ?? 0);
      break;
    }
    case "NEW_CLIENTS": {
      const first = await db.invoice.groupBy({ by: ["clientId"], where: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } }, _min: { issueDate: true } });
      const clients = await db.client.findMany({ where: { deletedAt: null }, select: { id: true, acquiredAt: true } });
      actual = clients.filter((c) => {
        const d = c.acquiredAt ?? first.find((f) => f.clientId === c.id)?._min.issueDate;
        return d && d >= range.from && d <= range.to;
      }).length;
      break;
    }
    case "CLIENT_RETENTION": {
      const r = (await computeMetrics(range)).metrics.find((m) => m.key === "retention");
      if (r?.value === null || r?.value === undefined) reason = r?.reason ?? "Insufficient Data";
      else actual = r.value * 100;
      break;
    }
    case "MRR": {
      const m = await getMrr();
      if (!m.profiles) reason = "No active recurring invoice profiles.";
      else actual = num(m.mrr);
      break;
    }
    case "CUSTOM": actual = g.manualActual === null ? null : num(g.manualActual); if (actual === null) reason = "Enter the actual value."; break;
  }
  if (actual === null || target === 0) return { actual, ratio: null, reason: reason ?? (target === 0 ? "Target is zero." : undefined), onTrack: null };
  const lower = GOAL_METRICS.find((x) => x.value === g.metric)?.lowerIsBetter;
  const ratio = actual / target;
  return { actual, ratio, onTrack: lower ? ratio <= 1 : ratio >= 1 };
}
