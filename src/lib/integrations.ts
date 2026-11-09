import "server-only";
import { createHash, createHmac } from "node:crypto";
import { db } from "./db";

// ───────── Outgoing webhooks ─────────

export const WEBHOOK_EVENTS: { event: string; label: string }[] = [
  { event: "client.created", label: "Client created" },
  { event: "client.updated", label: "Client updated" },
  { event: "quote.status_changed", label: "Proposal / quotation status changed (sent, accepted, rejected)" },
  { event: "invoice.issued", label: "Invoice / note issued" },
  { event: "invoice.paid", label: "Invoice fully paid" },
  { event: "invoice.cancelled", label: "Invoice cancelled" },
  { event: "payment.recorded", label: "Client payment recorded" },
  { event: "payment.voided", label: "Client payment voided" },
  { event: "transaction.created", label: "Income / expense recorded" },
  { event: "bill.created", label: "Vendor bill recorded" },
  { event: "bill.paid", label: "Vendor bill paid" },
  { event: "project.created", label: "Project created" },
  { event: "project.status_changed", label: "Project status changed" },
  { event: "task.completed", label: "Task completed" },
  { event: "subscription.renewed", label: "Subscription renewal recorded" },
  { event: "leave.requested", label: "Leave requested" },
];

export function signPayload(secret: string, body: string) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

async function deliver(webhookId: string, url: string, secret: string, event: string, data: unknown) {
  const payload = { id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), source: "dhm-business-os", data };
  const body = JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  let attempts = 0;
  let lastError: string | null = null;
  let status: number | null = null;
  const started = Date.now();
  while (attempts < 3) {
    attempts++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "DHM-Business-OS-Webhooks/1.0", "X-DHM-Event": event, "X-DHM-Delivery": payload.id, "X-DHM-Signature": signPayload(secret, body) },
        body,
        signal: AbortSignal.timeout(8000),
        redirect: "manual",
      });
      status = res.status;
      if (res.ok) {
        lastError = null;
        break;
      }
      lastError = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // client errors are not retried
    } catch (e) {
      lastError = (e as Error).message.slice(0, 300);
    }
    await new Promise((r) => setTimeout(r, 400 * attempts));
  }
  await db.webhookDelivery.create({
    data: { webhookId, event, payload: JSON.parse(body), status: lastError ? "failed" : "success", responseCode: status, error: lastError, attempts, durationMs: Date.now() - started },
  });
  return !lastError;
}

/** Queue an event for all subscribed webhooks. Never throws; never blocks the user's action. */
export function emitEvent(event: string, data: unknown) {
  const work = (async () => {
    try {
      const hooks = await db.webhook.findMany({ where: { isActive: true, OR: [{ events: { has: event } }, { events: { has: "*" } }] } });
      await Promise.all(hooks.map((h) => deliver(h.id, h.url, h.secret, event, data)));
    } catch (e) {
      console.error("[webhooks]", event, e);
    }
  })();
  // Let the response return immediately; Next.js keeps the function alive for after() work.
  import("next/server")
    .then(({ after }) => {
      try {
        after(() => work);
      } catch {
        /* outside a request (tests/scripts): the promise still runs */
      }
    })
    .catch(() => undefined);
}

export async function sendTestEvent(webhookId: string) {
  const h = await db.webhook.findUniqueOrThrow({ where: { id: webhookId } });
  return deliver(h.id, h.url, h.secret, "ping", { message: "Test event from DHM Business OS", webhook: h.name });
}

// ───────── Inbound REST API (API keys) ─────────

export const API_SCOPES: { scope: string; label: string }[] = [
  { scope: "clients:read", label: "Read clients" },
  { scope: "clients:write", label: "Create / update clients (CRM sync)" },
  { scope: "quotes:read", label: "Read proposals & quotations" },
  { scope: "invoices:read", label: "Read invoices & notes" },
  { scope: "payments:read", label: "Read payments & receipts" },
  { scope: "transactions:read", label: "Read income & expense transactions" },
  { scope: "projects:read", label: "Read projects" },
  { scope: "tasks:read", label: "Read tasks" },
  { scope: "vendors:read", label: "Read vendors & bills" },
  { scope: "subscriptions:read", label: "Read subscriptions" },
  { scope: "reports:read", label: "Read financial summary (P&L, receivables, MRR)" },
];

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function authenticateApiKey(req: Request, scope: string) {
  const auth = req.headers.get("authorization");
  const raw = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key")?.trim();
  if (!raw || !raw.startsWith("dhm_")) return { ok: false as const, status: 401, error: "Missing or malformed API key. Send 'Authorization: Bearer dhm_…'." };
  const key = await db.apiKey.findUnique({ where: { keyHash: hashApiKey(raw) } });
  if (!key || key.revokedAt) return { ok: false as const, status: 401, error: "Invalid or revoked API key." };
  if (!key.scopes.includes(scope) && !key.scopes.includes("*")) return { ok: false as const, status: 403, error: `This key lacks the '${scope}' scope.` };
  await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { ok: true as const, key };
}
