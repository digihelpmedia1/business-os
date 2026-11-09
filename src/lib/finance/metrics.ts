import "server-only";
import { db } from "@/lib/db";
import { D, Decimal, num } from "@/lib/money";
import { addMonths, endOfMonth, monthKey, monthLabel, monthsInRange, previousPeriod, startOfMonth, todayIST } from "@/lib/dates";
import { concentration, groupByMonth, linearRegression, monthlyFactor, summarizePnl } from "./engine";
import { getPnl, loadPeriod, projectProfitability, sumBy, type Range } from "./reports";
import { totalCash } from "./ledger";

export type MetricFormat = "money" | "percent" | "ratio" | "number" | "months";

export type Metric = {
  key: string;
  label: string;
  group: "Financial" | "Agency";
  format: MetricFormat;
  formula: string;
  value: number | null; // null ⇒ Insufficient Data
  reason?: string; // why it is insufficient / caveat
  previous?: number | null;
  infinite?: boolean;
};

const insufficient = (reason: string) => ({ value: null, reason });

function growth(current: number, previous: number): { value: number | null; reason?: string } {
  if (previous === 0) return insufficient("Previous period value is zero — growth cannot be calculated.");
  return { value: (current - previous) / Math.abs(previous) };
}

/** Recurring revenue from active recurring-invoice profiles (taxable value, monthly-normalised). */
export async function getMrr() {
  const profiles = await db.recurringInvoice.findMany({
    where: { isActive: true, OR: [{ endDate: null }, { endDate: { gte: todayIST() } }] },
    select: { id: true, frequency: true, items: true, clientId: true },
  });
  let mrr = new Decimal(0);
  for (const p of profiles) {
    const items = (Array.isArray(p.items) ? p.items : []) as { quantity?: string; unitPrice?: string; discountPercent?: string }[];
    const taxable = items.reduce((a, it) => {
      const sub = D(it.quantity ?? 0).times(D(it.unitPrice ?? 0));
      return a.plus(sub.minus(sub.times(D(it.discountPercent ?? 0)).dividedBy(100)));
    }, new Decimal(0));
    mrr = mrr.plus(taxable.times(monthlyFactor(p.frequency)));
  }
  return { mrr, profiles: profiles.length, clients: new Set(profiles.map((p) => p.clientId)).size };
}

/** Clients with recognised revenue in each month (from invoices). */
async function activeClientsByMonth(months: string[], from: Date, to: Date) {
  const invoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] },
      type: { in: ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"] },
      issueDate: { gte: from, lte: to },
    },
    select: { clientId: true, issueDate: true },
  });
  const map = new Map<string, Set<string>>(months.map((m) => [m, new Set()]));
  invoices.forEach((i) => map.get(monthKey(i.issueDate))?.add(i.clientId));
  return map;
}

function clientsIn(range: Range, rows: { clientId: string; issueDate: Date }[]) {
  return new Set(rows.filter((r) => r.issueDate >= range.from && r.issueDate <= range.to).map((r) => r.clientId));
}

export async function computeMetrics(range: Range) {
  const prev = previousPeriod(range);
  const today = todayIST();
  const [cur, before, period, mrrInfo, cash] = await Promise.all([
    getPnl(range),
    getPnl(prev),
    loadPeriod(range),
    getMrr(),
    totalCash(today),
  ]);

  // Revenue-bearing invoice activity over a wide window (for retention / churn / LTV).
  const historyFrom = startOfMonth(addMonths(range.from, -12));
  const billedRows = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] },
      type: { in: ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"] },
      issueDate: { gte: historyFrom, lte: range.to },
    },
    select: { clientId: true, issueDate: true },
  });

  const metrics: Metric[] = [];
  const add = (m: Omit<Metric, "value" | "reason"> & { value: number | null; reason?: string }) => metrics.push(m);

  const revenue = num(cur.revenue);
  const revenuePrev = num(before.revenue);
  add({ key: "gross_revenue", label: "Gross Revenue", group: "Financial", format: "money",
    formula: "Σ taxable value of issued GST/Non-GST invoices & debit notes + revenue recorded without invoice (excl. GST)",
    value: num(cur.grossRevenue), previous: num(before.grossRevenue) });
  add({ key: "net_revenue", label: "Net Revenue", group: "Financial", format: "money",
    formula: "Gross Revenue − Credit Notes", value: revenue, previous: revenuePrev });
  add({ key: "gross_profit", label: "Gross Profit", group: "Financial", format: "money",
    formula: "Net Revenue − Cost of Services", value: num(cur.grossProfit), previous: num(before.grossProfit) });
  add({ key: "operating_expenses", label: "Operating Expenses", group: "Financial", format: "money",
    formula: "Σ expenses in 'Operating expense' categories (net of claimable GST)", value: num(cur.operatingExpenses), previous: num(before.operatingExpenses) });
  add({ key: "operating_profit", label: "Operating Profit", group: "Financial", format: "money",
    formula: "Gross Profit − Operating Expenses", value: num(cur.operatingProfit), previous: num(before.operatingProfit) });
  add({ key: "operating_margin", label: "Operating Margin", group: "Financial", format: "percent",
    formula: "Operating Profit ÷ Net Revenue",
    ...(revenue > 0 ? { value: num(cur.operatingProfit) / revenue } : insufficient("No revenue in this period.")),
    previous: revenuePrev > 0 ? num(before.operatingProfit) / revenuePrev : null });
  add({ key: "net_profit", label: "Net Profit", group: "Financial", format: "money",
    formula: "Operating Profit + Other Income − Non-operating Expenses", value: num(cur.netProfit), previous: num(before.netProfit) });
  add({ key: "mrr", label: "Monthly Recurring Revenue", group: "Financial", format: "money",
    formula: "Σ active recurring invoice profiles (taxable value) normalised to one month",
    ...(mrrInfo.profiles > 0 ? { value: num(mrrInfo.mrr) } : insufficient("No active recurring invoice profiles.")) });
  add({ key: "arr", label: "Annual Recurring Revenue", group: "Financial", format: "money",
    formula: "MRR × 12", ...(mrrInfo.profiles > 0 ? { value: num(mrrInfo.mrr) * 12 } : insufficient("No active recurring invoice profiles.")) });

  const billedClients = clientsIn(range, billedRows);
  add({ key: "arpc", label: "Average Revenue per Client", group: "Financial", format: "money",
    formula: "Net Revenue ÷ number of clients invoiced in the period",
    ...(billedClients.size > 0 ? { value: revenue / billedClients.size } : insufficient("No clients were invoiced in this period.")) });
  add({ key: "revenue_growth", label: "Revenue Growth Rate", group: "Financial", format: "percent",
    formula: "(Net Revenue − previous period) ÷ previous period", ...growth(revenue, revenuePrev) });
  add({ key: "expense_growth", label: "Expense Growth Rate", group: "Financial", format: "percent",
    formula: "(Total expenses − previous period) ÷ previous period", ...growth(num(cur.totalExpenses), num(before.totalExpenses)) });
  add({ key: "cash_flow", label: "Net Cash Flow", group: "Financial", format: "money",
    formula: "Cash received − cash paid (all accounts, transfers excluded)", value: num(cur.netCashFlow), previous: num(before.netCashFlow) });

  // Runway: cash ÷ average monthly net burn over the last 3 complete months.
  const lastComplete = endOfMonth(addMonths(startOfMonth(today), -1));
  const burnRange = { from: startOfMonth(addMonths(today, -3)), to: lastComplete };
  const burnPnl = await getPnl(burnRange);
  const avgNet = num(burnPnl.netCashFlow) / 3;
  const hasActivity = num(burnPnl.cashIn) + num(burnPnl.cashOut) > 0;
  add({ key: "cash_runway", label: "Cash Runway", group: "Financial", format: "months",
    formula: "Current cash balance ÷ average monthly net cash burn (last 3 complete months)",
    ...(!hasActivity
      ? insufficient("No cash transactions in the last 3 complete months.")
      : avgNet >= 0
        ? { value: null, infinite: true, reason: "Cash flow is positive — the business is not burning cash." }
        : { value: num(cash) / Math.abs(avgNet) }) });

  // CAC
  const acquisitionSpend = period.entries.filter((e) => e.isAcquisition && e.bucket !== "REVENUE").reduce((a, e) => a + num(e.amount), 0);
  const firstInvoice = await db.invoice.groupBy({
    by: ["clientId"],
    where: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] }, type: { in: ["TAX_INVOICE", "NON_GST"] } },
    _min: { issueDate: true },
  });
  const acquiredClients = await db.client.findMany({ where: { deletedAt: null }, select: { id: true, acquiredAt: true } });
  const newClients = acquiredClients.filter((c) => {
    const d = c.acquiredAt ?? firstInvoice.find((f) => f.clientId === c.id)?._min.issueDate ?? null;
    return d && d >= range.from && d <= range.to;
  }).length;
  const cac = newClients > 0 && acquisitionSpend > 0 ? acquisitionSpend / newClients : null;
  add({ key: "new_clients", label: "New Clients", group: "Agency", format: "number",
    formula: "Clients whose acquisition date (or first invoice date) falls in the period", value: newClients });
  add({ key: "cac", label: "Customer Acquisition Cost (CAC)", group: "Agency", format: "money",
    formula: "Spend in categories flagged 'acquisition' ÷ new clients in the period",
    ...(cac !== null ? { value: cac } : insufficient(newClients === 0 ? "No new clients in this period." : "No acquisition spend recorded (flag categories as acquisition spend in Finance → Categories).")) });

  // Retention / churn: clients invoiced in previous period that were invoiced again in this period.
  const prevClients = clientsIn(prev, billedRows);
  const retained = [...prevClients].filter((c) => billedClients.has(c)).length;
  const retention = prevClients.size > 0 ? retained / prevClients.size : null;
  add({ key: "retention", label: "Client Retention Rate", group: "Agency", format: "percent",
    formula: "Clients invoiced in both previous and current period ÷ clients invoiced in previous period",
    ...(retention !== null ? { value: retention } : insufficient("No clients were invoiced in the previous period.")) });
  add({ key: "churn", label: "Client Churn Rate", group: "Agency", format: "percent",
    formula: "1 − Client Retention Rate",
    ...(retention !== null ? { value: 1 - retention } : insufficient("No clients were invoiced in the previous period.")) });

  // LTV = monthly ARPC × gross margin ÷ average monthly churn (needs ≥ 3 months of history).
  const ltvMonths = monthsInRange(startOfMonth(addMonths(range.to, -6)), endOfMonth(range.to)).slice(0, 7);
  const active = await activeClientsByMonth(ltvMonths, startOfMonth(addMonths(range.to, -6)), endOfMonth(range.to));
  const churns: number[] = [];
  for (let i = 1; i < ltvMonths.length; i++) {
    const a = active.get(ltvMonths[i - 1]!)!;
    const b = active.get(ltvMonths[i]!)!;
    if (a.size > 0) churns.push([...a].filter((c) => !b.has(c)).length / a.size);
  }
  const avgChurn = churns.length >= 3 ? churns.reduce((x, y) => x + y, 0) / churns.length : null;
  const monthsInPeriod = monthsInRange(range.from, range.to).length;
  const grossMargin = revenue > 0 ? num(cur.grossProfit) / revenue : null;
  const monthlyArpc = billedClients.size > 0 ? revenue / monthsInPeriod / billedClients.size : null;
  let ltv: number | null = null;
  let ltvReason: string | undefined;
  if (avgChurn === null) ltvReason = "Needs at least 4 months of invoicing history to estimate churn.";
  else if (avgChurn === 0) ltvReason = "No churn observed in the last 6 months — lifetime cannot be estimated.";
  else if (grossMargin === null || monthlyArpc === null) ltvReason = "No revenue in this period.";
  else ltv = (monthlyArpc * grossMargin) / avgChurn;
  add({ key: "ltv", label: "Customer Lifetime Value (LTV)", group: "Agency", format: "money",
    formula: "(Monthly revenue per client × Gross margin %) ÷ Average monthly churn (last 6 months)",
    value: ltv, reason: ltvReason });
  add({ key: "ltv_cac", label: "LTV : CAC Ratio", group: "Agency", format: "ratio",
    formula: "LTV ÷ CAC", ...(ltv !== null && cac ? { value: ltv / cac } : insufficient("Requires both LTV and CAC.")) });

  // Revenue per employee (employees only; freelancers excluded).
  const headcount = await db.employee.count({
    where: {
      deletedAt: null,
      type: "EMPLOYEE",
      OR: [{ joiningDate: null }, { joiningDate: { lte: range.to } }],
      AND: [{ OR: [{ exitDate: null }, { exitDate: { gte: range.from } }] }],
    },
  });
  add({ key: "revenue_per_employee", label: "Revenue per Employee", group: "Agency", format: "money",
    formula: "Net Revenue ÷ employees active during the period (freelancers excluded)",
    ...(headcount > 0 ? { value: revenue / headcount } : insufficient("No employees recorded.")) });

  // Concentration
  const byClient = sumBy(period.entries, (e) => e.clientId, (e) => e.bucket === "REVENUE");
  const conc = concentration([...byClient.values()].map(num).filter((v) => v > 0));
  add({ key: "concentration_top1", label: "Revenue Concentration (Top Client)", group: "Agency", format: "percent",
    formula: "Largest client's revenue ÷ Net Revenue", ...(conc ? { value: conc.top1 } : insufficient("No revenue in this period.")) });
  add({ key: "concentration_top5", label: "Revenue Concentration (Top 5)", group: "Agency", format: "percent",
    formula: "Top 5 clients' revenue ÷ Net Revenue", ...(conc ? { value: conc.top5 } : insufficient("No revenue in this period.")) });

  return { metrics, pnl: cur, previousPnl: before, period, cash, mrr: mrrInfo };
}

/** Client-wise profitability: revenue − attributable direct costs (expenses, bills, time). */
export async function clientProfitability(range: Range) {
  const [period, projects, clients, time] = await Promise.all([
    loadPeriod(range),
    db.project.findMany({ select: { id: true, clientId: true } }),
    db.client.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    db.timeEntry.findMany({ where: { date: { gte: range.from, lte: range.to } }, select: { projectId: true, hours: true, costRate: true } }),
  ]);
  const clientOf = (e: { clientId: string | null; projectId: string | null }) =>
    e.clientId ?? projects.find((p) => p.id === e.projectId)?.clientId ?? null;
  const rev = new Map<string, number>();
  const cost = new Map<string, number>();
  for (const e of period.entries) {
    const c = clientOf(e);
    if (!c) continue;
    if (e.bucket === "REVENUE") rev.set(c, (rev.get(c) ?? 0) + num(e.amount));
    else if (e.bucket === "COS" || e.bucket === "OPEX" || e.bucket === "NONOP") cost.set(c, (cost.get(c) ?? 0) + num(e.amount));
  }
  for (const t of time) {
    const c = projects.find((p) => p.id === t.projectId)?.clientId;
    if (c) cost.set(c, (cost.get(c) ?? 0) + num(D(t.hours).times(D(t.costRate))));
  }
  return clients
    .map((c) => {
      const r = rev.get(c.id) ?? 0;
      const k = cost.get(c.id) ?? 0;
      return { id: c.id, name: c.name, revenue: r, cost: k, profit: r - k, margin: r > 0 ? (r - k) / r : null };
    })
    .filter((c) => c.revenue !== 0 || c.cost !== 0)
    .sort((a, b) => b.revenue - a.revenue);
}

/** Service-wise profitability: invoice-line revenue by service − costs of projects/transactions tagged to that service. */
export async function serviceProfitability(range: Range) {
  const [period, projects, services, time] = await Promise.all([
    loadPeriod(range),
    db.project.findMany({ select: { id: true, serviceId: true } }),
    db.service.findMany({ select: { id: true, name: true } }),
    db.timeEntry.findMany({ where: { date: { gte: range.from, lte: range.to } }, select: { projectId: true, hours: true, costRate: true } }),
  ]);
  const serviceOf = (e: { serviceId: string | null; projectId: string | null }) =>
    e.serviceId ?? projects.find((p) => p.id === e.projectId)?.serviceId ?? null;
  const rev = new Map<string, number>();
  const cost = new Map<string, number>();
  for (const e of period.entries) {
    const s = serviceOf(e);
    if (!s) continue;
    if (e.bucket === "REVENUE") rev.set(s, (rev.get(s) ?? 0) + num(e.amount));
    else if (e.bucket !== "OTHER_INCOME") cost.set(s, (cost.get(s) ?? 0) + num(e.amount));
  }
  for (const t of time) {
    const s = projects.find((p) => p.id === t.projectId)?.serviceId;
    if (s) cost.set(s, (cost.get(s) ?? 0) + num(D(t.hours).times(D(t.costRate))));
  }
  return services
    .map((s) => {
      const r = rev.get(s.id) ?? 0;
      const k = cost.get(s.id) ?? 0;
      return { id: s.id, name: s.name, revenue: r, cost: k, profit: r - k, margin: r > 0 ? (r - k) / r : null };
    })
    .filter((s) => s.revenue !== 0 || s.cost !== 0)
    .sort((a, b) => b.profit - a.profit);
}

/** Linear-trend forecast of revenue & expenses for the next `ahead` months. */
export async function forecast(ahead = 3, lookback = 12) {
  const today = todayIST();
  const to = endOfMonth(addMonths(startOfMonth(today), -1));
  const from = startOfMonth(addMonths(today, -lookback));
  const months = monthsInRange(from, to);
  const { entries } = await loadPeriod({ from, to });
  const grouped = groupByMonth(entries, months);
  const series = months.map((m) => {
    const p = summarizePnl(grouped.get(m) ?? []);
    return { month: m, revenue: num(p.revenue), expenses: num(p.totalExpenses) };
  });
  // Ignore leading months with no activity at all (business not yet using the system).
  const firstActive = series.findIndex((s) => s.revenue !== 0 || s.expenses !== 0);
  const hist = firstActive === -1 ? [] : series.slice(firstActive);
  if (hist.length < 4) {
    return { ok: false as const, reason: "At least 4 complete months of revenue/expense data are needed to forecast.", history: hist };
  }
  const revFit = linearRegression(hist.map((h) => h.revenue))!;
  const expFit = linearRegression(hist.map((h) => h.expenses))!;
  const projections = Array.from({ length: ahead }, (_, i) => {
    const key = monthKey(addMonths(startOfMonth(today), i));
    const x = hist.length + i;
    const revenue = Math.max(0, revFit.predict(x));
    const expenses = Math.max(0, expFit.predict(x));
    return { month: key, label: monthLabel(key), revenue, expenses, profit: revenue - expenses };
  });
  return {
    ok: true as const,
    history: hist.map((h) => ({ ...h, label: monthLabel(h.month) })),
    projections,
    revenueR2: revFit.r2,
    expenseR2: expFit.r2,
    method: `Ordinary least-squares linear trend over the last ${hist.length} complete months.`,
  };
}

export { projectProfitability };
