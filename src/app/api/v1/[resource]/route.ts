import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateApiKey } from "@/lib/integrations";
import { upsertClientFromCrm } from "@/lib/crm-sync";
import { getPnl, getReceivables } from "@/lib/finance/reports";
import { getMrr } from "@/lib/finance/metrics";
import { getSettings } from "@/lib/settings";
import { isoDate, resolveRange, todayIST, toDateOnly } from "@/lib/dates";

export const runtime = "nodejs";

// Public REST API for third-party apps (n8n, Zapier, Make, your CRM, custom software).
// Auth: Authorization: Bearer dhm_…  (create keys in Settings → Integrations)
// Pagination: ?limit=1-200 (default 50) & ?offset=…   Incremental sync: ?updatedSince=ISO-8601

const RESOURCES: Record<string, { scope: string; fetch: (q: Query) => Promise<unknown[]> }> = {
  clients: {
    scope: "clients:read",
    fetch: (q) => db.client.findMany({ where: { deletedAt: null, ...q.updated }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  quotes: {
    scope: "quotes:read",
    fetch: (q) => db.quote.findMany({ where: { deletedAt: null, ...q.updated }, include: { items: true }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  invoices: {
    scope: "invoices:read",
    fetch: (q) => db.invoice.findMany({ where: { deletedAt: null, ...q.updated, ...(q.params.status ? { status: q.params.status as "PAID" } : {}) }, include: { items: true }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  payments: {
    scope: "payments:read",
    fetch: (q) => db.payment.findMany({ where: { ...q.updated }, include: { invoice: { select: { number: true } } }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  transactions: {
    scope: "transactions:read",
    fetch: (q) => db.transaction.findMany({ where: { deletedAt: null, ...q.updated, ...q.dateRange("date") }, include: { category: { select: { name: true, kind: true } }, account: { select: { name: true } } }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  projects: {
    scope: "projects:read",
    fetch: (q) => db.project.findMany({ where: { deletedAt: null, ...q.updated }, include: { client: { select: { id: true, name: true } } }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  tasks: {
    scope: "tasks:read",
    fetch: (q) => db.task.findMany({ where: { deletedAt: null, ...q.updated, ...(q.params.projectId ? { projectId: q.params.projectId } : {}) }, include: { assignee: { select: { name: true } } }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  vendors: {
    scope: "vendors:read",
    fetch: (q) => db.vendor.findMany({ where: { deletedAt: null, ...q.updated }, select: { id: true, name: true, category: true, email: true, phone: true, gstin: true, isActive: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  bills: {
    scope: "vendors:read",
    fetch: (q) => db.vendorBill.findMany({ where: { deletedAt: null, ...q.updated }, include: { vendor: { select: { name: true } } }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
  subscriptions: {
    scope: "subscriptions:read",
    fetch: (q) => db.subscription.findMany({ where: { deletedAt: null, ...q.updated }, orderBy: { updatedAt: "asc" }, take: q.limit, skip: q.offset }),
  },
};

type Query = {
  limit: number;
  offset: number;
  params: Record<string, string>;
  updated: { updatedAt?: { gt: Date } };
  dateRange: (field: string) => Record<string, unknown>;
};

function json(data: unknown, status = 200) {
  return new NextResponse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const url = new URL(req.url);
  const p = Object.fromEntries(url.searchParams.entries());

  if (resource === "summary") {
    const auth = await authenticateApiKey(req, "reports:read");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    const settings = await getSettings();
    const range = resolveRange(p.period ?? "this_month", { from: p.from, to: p.to }, settings.fyStartMonth);
    const [pnl, ar, mrr] = await Promise.all([getPnl(range), getReceivables(todayIST()), getMrr()]);
    return json({
      period: { from: isoDate(range.from), to: isoDate(range.to), label: range.label },
      currency: "INR",
      revenue: pnl.revenue.toFixed(2), expenses: pnl.totalExpenses.toFixed(2), netProfit: pnl.netProfit.toFixed(2),
      cashReceived: pnl.clientReceipts.toFixed(2), receivablesOutstanding: ar.total.toFixed(2), mrr: mrr.profiles ? mrr.mrr.toFixed(2) : null,
    });
  }

  const def = RESOURCES[resource];
  if (!def) return json({ error: `Unknown resource. Available: ${[...Object.keys(RESOURCES), "summary"].join(", ")}` }, 404);
  const auth = await authenticateApiKey(req, def.scope);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const limit = Math.min(Math.max(Number(p.limit) || 50, 1), 200);
  const offset = Math.max(Number(p.offset) || 0, 0);
  let updated: Query["updated"] = {};
  if (p.updatedSince) {
    const d = new Date(p.updatedSince);
    if (Number.isNaN(d.getTime())) return json({ error: "updatedSince must be an ISO date-time" }, 400);
    updated = { updatedAt: { gt: d } };
  }
  const dateRange = (field: string) => {
    try {
      return p.from || p.to ? { [field]: { ...(p.from ? { gte: toDateOnly(p.from) } : {}), ...(p.to ? { lte: toDateOnly(p.to) } : {}) } } : {};
    } catch {
      return {};
    }
  };
  const data = await def.fetch({ limit, offset, params: p, updated, dateRange });
  return json({ data, pagination: { limit, offset, returned: data.length, nextOffset: data.length === limit ? offset + limit : null } });
}

export async function POST(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (resource !== "clients") return json({ error: "Only POST /api/v1/clients is supported (create or update a client by externalId)." }, 405);
  const auth = await authenticateApiKey(req, "clients:write");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const items = Array.isArray(body) ? body : [body];
  if (items.length > 100) return json({ error: "Send at most 100 clients per request" }, 400);
  const results = [];
  for (const item of items) {
    try {
      const r = await upsertClientFromCrm(item, auth.key.name);
      results.push({ ok: true, id: r.client.id, externalCrmId: r.client.externalCrmId, created: r.created });
    } catch (e) {
      results.push({ ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message });
    }
  }
  return json(Array.isArray(body) ? { results } : results[0], results.every((r) => r.ok) ? 200 : 207);
}
