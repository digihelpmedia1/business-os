import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "./db";
import { can, type AccessMap, type ModuleKey } from "./permissions";
import { fmtDate, isoDate, resolveRange, todayIST, addDays } from "./dates";
import { num, D, Decimal } from "./money";
import { getSettings } from "./settings";
import { expenseByCategory, getCashFlow, getPayables, getPnl, getReceivables, projectProfitability, revenueByService } from "./finance/reports";
import { clientProfitability, computeMetrics, forecast, getMrr, serviceProfitability } from "./finance/metrics";
import { goalProgress, GOAL_METRICS } from "./finance/goals";
import { monthlyFactor } from "./finance/engine";

// The assistant can only READ data through these tools. There is no tool that
// writes, so it cannot modify financial records — any change must be made by a
// person in the app (where validation and the audit log apply).

export const ASSISTANT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export function assistantConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const periodSchema = z.object({
  period: z.enum(["this_month", "last_month", "last_3_months", "last_6_months", "this_fy", "prev_fy", "custom"]).default("this_month"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const periodProps = {
  period: { type: "string", enum: ["this_month", "last_month", "last_3_months", "last_6_months", "this_fy", "prev_fy", "custom"], description: "Reporting period. Indian financial year runs April–March. Use custom with from/to (YYYY-MM-DD) for other ranges." },
  from: { type: "string", description: "Start date YYYY-MM-DD (only for custom)" },
  to: { type: "string", description: "End date YYYY-MM-DD (only for custom)" },
} as const;

type ToolDef = { tool: Anthropic.Tool; module: ModuleKey; run: (input: unknown) => Promise<unknown> };

async function rangeOf(input: unknown) {
  const p = periodSchema.parse(input ?? {});
  const settings = await getSettings();
  const r = resolveRange(p.period, { from: p.from, to: p.to }, settings.fyStartMonth);
  return { from: r.from, to: r.to, label: `${r.label} (${isoDate(r.from)} to ${isoDate(r.to)})` };
}

const money = (d: Decimal | number) => Math.round((typeof d === "number" ? d : num(d)) * 100) / 100;

const TOOLS: ToolDef[] = [
  {
    module: "finance",
    tool: {
      name: "get_financial_summary",
      description: "Profit & loss (accrual basis, INR, GST excluded) plus cash received/paid for a period: revenue, credit notes, cost of services, gross profit, operating expenses, operating profit, other income, net profit, cash in/out.",
      input_schema: { type: "object", properties: { ...periodProps } },
    },
    run: async (input) => {
      const r = await rangeOf(input);
      const p = await getPnl(r);
      return {
        period: r.label, basis: "accrual (invoice date, excl. GST); cash figures from bank/cash accounts",
        revenue: money(p.revenue), creditNotes: money(p.creditNotes), costOfServices: money(p.costOfServices), grossProfit: money(p.grossProfit),
        operatingExpenses: money(p.operatingExpenses), operatingProfit: money(p.operatingProfit), otherIncome: money(p.otherIncome),
        nonOperatingExpenses: money(p.nonOperating), netProfit: money(p.netProfit), totalExpenses: money(p.totalExpenses),
        cashReceivedFromClients: money(p.clientReceipts), totalCashIn: money(p.cashIn), totalCashOut: money(p.cashOut),
        lines: p.lines.map((l) => ({ section: l.bucket, name: l.categoryName, amount: money(l.amount) })),
      };
    },
  },
  {
    module: "finance",
    tool: {
      name: "compare_periods",
      description: "Compare P&L and cash between two periods (e.g. this month vs last month).",
      input_schema: {
        type: "object",
        properties: { a: { type: "object", properties: { ...periodProps } }, b: { type: "object", properties: { ...periodProps } } },
        required: ["a", "b"],
      },
    },
    run: async (input) => {
      const { a, b } = z.object({ a: z.unknown(), b: z.unknown() }).parse(input);
      const [ra, rb] = await Promise.all([rangeOf(a), rangeOf(b)]);
      const [pa, pb] = await Promise.all([getPnl(ra), getPnl(rb)]);
      const pick = (p: Awaited<ReturnType<typeof getPnl>>) => ({ revenue: money(p.revenue), expenses: money(p.totalExpenses), grossProfit: money(p.grossProfit), netProfit: money(p.netProfit), cashIn: money(p.cashIn), cashOut: money(p.cashOut) });
      return { a: { period: ra.label, ...pick(pa) }, b: { period: rb.label, ...pick(pb) } };
    },
  },
  {
    module: "finance",
    tool: {
      name: "get_expense_breakdown",
      description: "Expenses by category for a period (accrual, net of claimable input GST), largest first.",
      input_schema: { type: "object", properties: { ...periodProps } },
    },
    run: async (input) => {
      const r = await rangeOf(input);
      return { period: r.label, categories: (await expenseByCategory(r)).map((c) => ({ ...c, amount: money(c.amount) })) };
    },
  },
  {
    module: "finance",
    tool: {
      name: "get_receivables",
      description: "Money pending from clients today: outstanding invoices with ageing buckets and per-invoice detail.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => {
      const r = await getReceivables(todayIST());
      return {
        totalOutstanding: money(r.total),
        ageing: r.buckets.map((b) => ({ bucket: b.bucket, amount: money(b.amount) })),
        invoices: r.rows.slice(0, 40).map((x) => ({ number: x.number, client: x.client.name, dueDate: x.dueDate ? isoDate(x.dueDate) : null, daysOverdue: x.daysOverdue, outstanding: money(x.outstanding) })),
      };
    },
  },
  {
    module: "finance",
    tool: {
      name: "get_payables_and_cash",
      description: "Unpaid vendor bills (accounts payable) and the current cash balance / cash-flow statement for a period.",
      input_schema: { type: "object", properties: { ...periodProps } },
    },
    run: async (input) => {
      const r = await rangeOf(input);
      const [ap, cf] = await Promise.all([getPayables(todayIST()), getCashFlow(r)]);
      return {
        payablesTotal: money(ap.total),
        bills: ap.rows.slice(0, 30).map((b) => ({ vendor: b.vendor.name, bill: b.billNumber, dueDate: b.dueDate ? isoDate(b.dueDate) : null, outstanding: money(b.outstanding) })),
        cashFlow: { period: r.label, opening: money(cf.opening), operating: money(cf.operating.total), investing: money(cf.investing.total), financing: money(cf.financing.total), closing: money(cf.closing) },
      };
    },
  },
  {
    module: "intelligence",
    tool: {
      name: "get_business_metrics",
      description: "Business-intelligence metrics with formulas for a period: gross/net revenue, margins, MRR, ARR, ARPC, growth, cash runway, CAC, LTV, retention, churn, revenue per employee, concentration. null value = insufficient data (reason given).",
      input_schema: { type: "object", properties: { ...periodProps } },
    },
    run: async (input) => {
      const r = await rangeOf(input);
      const { metrics } = await computeMetrics(r);
      return { period: r.label, metrics: metrics.map((m) => ({ metric: m.label, value: m.value, format: m.format, previousPeriod: m.previous ?? null, formula: m.formula, note: m.reason ?? null })) };
    },
  },
  {
    module: "intelligence",
    tool: {
      name: "get_profitability",
      description: "Profitability by service, by client, and by project (revenue minus attributable costs incl. time cost). Use for 'which service is most profitable' or 'which projects are unprofitable'.",
      input_schema: { type: "object", properties: { ...periodProps, scope: { type: "string", enum: ["service", "client", "project"], description: "What to break profitability down by" } }, required: ["scope"] },
    },
    run: async (input) => {
      const { scope } = z.object({ scope: z.enum(["service", "client", "project"]) }).passthrough().parse(input);
      const r = await rangeOf(input);
      if (scope === "service") return { period: r.label, services: (await serviceProfitability(r)).map((s) => ({ ...s, revenue: money(s.revenue), cost: money(s.cost), profit: money(s.profit) })), revenueByServiceLine: (await revenueByService(r)).map((s) => ({ ...s, amount: money(s.amount) })) };
      if (scope === "client") return { period: r.label, clients: (await clientProfitability(r)).slice(0, 30).map((s) => ({ ...s, revenue: money(s.revenue), cost: money(s.cost), profit: money(s.profit) })) };
      const p = await projectProfitability();
      return { basis: "all time", projects: p.filter((x) => !x.revenue.isZero() || !x.totalCost.isZero()).slice(0, 40).map((x) => ({ project: x.name, client: x.client?.name ?? null, status: x.status, revenue: money(x.revenue), directExpenses: money(x.directExpenses), timeCost: money(x.timeCost), profit: money(x.profit), margin: x.margin })) };
    },
  },
  {
    module: "intelligence",
    tool: {
      name: "get_forecast",
      description: "Linear-trend FORECAST of revenue and expenses for the next 3 months from recent complete months. This is a projection, not a fact.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => forecast(3, 12),
  },
  {
    module: "billing",
    tool: {
      name: "get_recurring_revenue",
      description: "Monthly recurring revenue (MRR) from active recurring-invoice profiles, with the profile list.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => {
      const m = await getMrr();
      const profiles = await db.recurringInvoice.findMany({ where: { isActive: true }, include: { client: { select: { name: true } } } });
      return { mrr: money(m.mrr), arr: money(num(m.mrr) * 12), activeProfiles: profiles.map((p) => ({ name: p.name, client: p.client.name, frequency: p.frequency, nextInvoice: isoDate(p.nextRunDate) })) };
    },
  },
  {
    module: "assets",
    tool: {
      name: "get_subscription_spend",
      description: "Software/AI/hosting/domain subscriptions: monthly-normalised cost, upcoming renewals, and actual amounts paid in a period.",
      input_schema: { type: "object", properties: { ...periodProps } },
    },
    run: async (input) => {
      const r = await rangeOf(input);
      const subs = await db.subscription.findMany({ where: { deletedAt: null, status: "ACTIVE" } });
      const paid = await db.transaction.aggregate({ where: { deletedAt: null, type: "EXPENSE", date: { gte: r.from, lte: r.to }, OR: [{ subscriptionId: { not: null } }, { category: { name: { in: ["Software Subscriptions", "Hosting & Domains"] } } }] }, _sum: { amount: true } });
      const monthly = subs.reduce((a, s) => a.plus(D(s.cost).times(monthlyFactor(s.billingCycle))), new Decimal(0));
      return {
        period: r.label, paidInPeriod: money(D(paid._sum.amount)), monthlyRunRate: money(monthly), annualRunRate: money(num(monthly) * 12),
        subscriptions: subs.map((s) => ({ name: s.name, type: s.kind, cycle: s.billingCycle, costPerCycle: money(D(s.cost)), renewal: isoDate(s.renewalDate), autoRenew: s.autoRenew })),
        renewingIn30Days: subs.filter((s) => s.renewalDate <= addDays(todayIST(), 30)).map((s) => s.name),
      };
    },
  },
  {
    module: "planning",
    tool: {
      name: "get_goals_progress",
      description: "Current business goals/targets with actual vs target progress.",
      input_schema: { type: "object", properties: {} },
    },
    run: async () => {
      const today = todayIST();
      const goals = await db.financialGoal.findMany({ where: { periodStart: { lte: today }, periodEnd: { gte: today } } });
      const out = [];
      for (const g of goals) {
        const p = await goalProgress(g);
        out.push({ goal: g.title, measure: GOAL_METRICS.find((m) => m.value === g.metric)?.label, period: `${fmtDate(g.periodStart)} – ${fmtDate(g.periodEnd)}`, target: money(D(g.target)), actual: p.actual, progress: p.ratio, onTrack: p.onTrack, note: p.reason ?? null });
      }
      return { goals: out };
    },
  },
];

function systemPrompt(companyName: string) {
  const today = todayIST();
  return `You are the business analyst inside DHM Business OS, the internal finance and operations system of ${companyName}, a digital & performance marketing agency in India.
Today is ${fmtDate(today)} (Asia/Kolkata). Currency is INR (₹); use Indian number formatting (lakh/crore where helpful). The financial year runs April–March.

How to answer:
- Get every number from the tools. Never estimate, assume or invent figures. If a tool returns no data or a null metric, say "Insufficient data" and explain what needs to be recorded.
- Revenue and profit are accrual-basis (invoice date, GST excluded). Cash received is separate — say which one you are using.
- Clearly separate three kinds of statements using these labels: **Fact** (calculated from records), **Forecast** (projection — only from get_forecast), **Recommendation** (your suggestion). Keep recommendations brief and practical.
- You can only read data. You cannot create, edit or delete records. If the user asks you to change something, explain where in the app they can do it themselves.
- Be concise: lead with the answer, then a short breakdown. Use small markdown tables for comparisons.`;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function runAssistant(history: ChatTurn[], access: AccessMap) {
  const settings = await getSettings();
  const allowed = TOOLS.filter((t) => can(access, t.module));
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((h) => ({ role: h.role, content: h.content }));
  const toolsUsed: string[] = [];
  const useFallback = FALLBACK_MODELS.has(ASSISTANT_MODEL);

  for (let step = 0; step < 8; step++) {
    const response = await client.beta.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 16000,
      system: systemPrompt(settings.companyName),
      output_config: { effort: "medium" },
      tools: allowed.map((t) => t.tool),
      messages,
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });

    if (response.stop_reason === "refusal") {
      return { answer: "I can't help with that request. Try asking about revenue, expenses, profit, receivables, projects or subscriptions.", toolsUsed };
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const answer = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { answer: answer || "I couldn't produce an answer. Please rephrase the question.", toolsUsed };
    }
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        const def = allowed.find((t) => t.tool.name === tu.name);
        toolsUsed.push(tu.name);
        if (!def) return { type: "tool_result" as const, tool_use_id: tu.id, content: "Tool not available for this user's access level.", is_error: true };
        try {
          const data = await def.run(tu.input);
          return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(data, (_k, v) => (v instanceof Date ? isoDate(v) : v)) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: tu.id, content: `Error: ${(e as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { answer: "That question needed too many steps. Please ask something more specific.", toolsUsed };
}

/** Deterministic quick facts shown on the page (no AI needed). */
export async function quickFacts(access: AccessMap) {
  if (!can(access, "finance")) return null;
  const settings = await getSettings();
  const r = resolveRange("this_month", {}, settings.fyStartMonth);
  const [p, ar, mrr] = await Promise.all([getPnl(r), getReceivables(todayIST()), getMrr()]);
  return { revenue: p.revenue, netProfit: p.netProfit, cashIn: p.clientReceipts, receivables: ar.total, mrr: mrr.profiles ? mrr.mrr : null };
}
