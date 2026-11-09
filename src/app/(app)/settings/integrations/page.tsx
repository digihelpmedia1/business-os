import { KeyRound, Pencil, Plus, Send, Trash2, Webhook } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/dates";
import { API_SCOPES, WEBHOOK_EVENTS } from "@/lib/integrations";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Notice } from "@/components/ui/primitives";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CopyButton } from "@/components/ui/client-buttons";
import { createApiKey, deleteWebhook, revokeApiKey, saveWebhook, testWebhook } from "@/server/actions/settings";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requirePageAccess("settings");
  const canEdit = can(user.access, "settings", "FULL");
  const [keys, hooks, deliveries, crmClients] = await Promise.all([
    db.apiKey.findMany({ include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.webhook.findMany({ orderBy: { createdAt: "desc" } }),
    db.webhookDelivery.findMany({ include: { webhook: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.client.count({ where: { externalCrmId: { not: null }, deletedAt: null } }),
  ]);
  const base = (process.env.APP_URL ?? "https://your-app.vercel.app").replace(/\/$/, "");
  const keyFields: FieldDef[] = [
    { name: "name", label: "Key name", required: true, placeholder: "e.g. DHM CRM, n8n, Zapier", span: 2 },
    { name: "_s", label: "Permissions", type: "heading" },
    ...API_SCOPES.map((s) => ({ name: `scope_${s.scope}`, label: s.label, type: "checkbox" as const })),
  ];
  const hookFields: FieldDef[] = [
    { name: "name", label: "Name", required: true, placeholder: "n8n — invoice automation" },
    { name: "url", label: "Endpoint URL", required: true, placeholder: "https://…" },
    { name: "isActive", label: "Active", type: "checkbox", span: 2 },
    { name: "_e", label: "Send these events", type: "heading" },
    { name: "event_*", label: "All events", type: "checkbox", span: 2 },
    ...WEBHOOK_EVENTS.map((e) => ({ name: `event_${e.event}`, label: e.label, type: "checkbox" as const })),
  ];
  return (
    <>
      <PageHeader title="Integrations" description="Connect DHM Business OS to your CRM and any other platform — n8n, Zapier, Make, Google Sheets, Slack, WhatsApp tools or custom software." />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5"><p className="text-sm font-semibold">1 · Your CRM → clients</p><p className="mt-1 text-[13px] text-muted">Converted leads become clients automatically, matched by CRM ID (no duplicates). {crmClients} client(s) linked to the CRM so far.</p></Card>
        <Card className="p-5"><p className="text-sm font-semibold">2 · Any app ← REST API</p><p className="mt-1 text-[13px] text-muted">Read clients, invoices, payments, transactions, projects, tasks, vendors and a financial summary with a scoped API key.</p></Card>
        <Card className="p-5"><p className="text-sm font-semibold">3 · Any app ← Webhooks</p><p className="mt-1 text-[13px] text-muted">Get a signed HTTP POST when an invoice is issued or paid, a payment arrives, a quote is accepted, a task is completed and more.</p></Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="API keys" description="Keys are shown once and stored hashed. Give each app its own key with only the permissions it needs." action={canEdit ? <FormDialog trigger={<><Plus /> New API key</>} triggerSize="sm" title="Create API key" fields={keyFields} defaults={{ "scope_clients:write": true, "scope_clients:read": true }} action={createApiKey} size="lg" submitLabel="Create key" /> : null} />
        {keys.length ? (
          <ul className="divide-y divide-line">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
                <KeyRound className="h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{k.name} <span className="font-mono text-xs text-muted">{k.prefix}…</span></p>
                  <p className="text-xs text-muted">{k.scopes.join(", ")} · created by {k.createdBy.name} · last used {k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : "never"}</p>
                </div>
                {k.revokedAt ? <Badge tone="danger">Revoked</Badge> : canEdit ? <ConfirmAction action={revokeApiKey.bind(null, k.id)} label="Revoke" title={`Revoke “${k.name}”?`} message="Apps using this key will stop working immediately." confirmLabel="Revoke" /> : <Badge tone="success">Active</Badge>}
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<KeyRound />} title="No API keys" description="Create a key for your CRM or automation tool." className="py-8" />}
      </Card>

      <Card className="mb-6">
        <CardHeader title="Webhooks" description="Payloads are JSON, signed with HMAC-SHA256 in the X-DHM-Signature header (sha256=…). Failed deliveries are retried up to 3 times." action={canEdit ? <FormDialog trigger={<><Plus /> Add webhook</>} triggerSize="sm" title="Add webhook" fields={hookFields} defaults={{ isActive: true, "event_*": true }} action={saveWebhook.bind(null, null)} size="lg" /> : null} />
        {hooks.length ? (
          <ul className="divide-y divide-line">
            {hooks.map((h) => (
              <li key={h.id} className="px-5 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Webhook className="h-4 w-4 text-muted" />
                  <span className="font-medium">{h.name}</span>
                  {h.isActive ? <Badge tone="success">Active</Badge> : <Badge>Paused</Badge>}
                  <span className="truncate font-mono text-xs text-muted">{h.url}</span>
                  <span className="flex-1" />
                  {canEdit ? (
                    <>
                      <ConfirmAction action={testWebhook.bind(null, h.id)} label={<><Send /> Test</>} noConfirm variant="ghost" />
                      <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit webhook" fields={hookFields} size="lg" action={saveWebhook.bind(null, h.id)}
                        defaults={{ name: h.name, url: h.url, isActive: h.isActive, ...Object.fromEntries(h.events.map((e) => [`event_${e}`, true])) }} />
                      <ConfirmAction action={deleteWebhook.bind(null, h.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title={`Delete “${h.name}”?`} confirmLabel="Delete" />
                    </>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted">Events: {h.events.includes("*") ? "all" : h.events.join(", ")}</p>
                {canEdit ? <div className="mt-2 flex items-center gap-2 text-xs"><span className="text-muted">Signing secret:</span><code className="rounded bg-surface-2 px-1.5 py-0.5">{h.secret.slice(0, 12)}…</code><CopyButton text={h.secret} label="Copy secret" size="sm" variant="ghost" /></div> : null}
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<Webhook />} title="No webhooks" description="Add an endpoint from n8n, Zapier, Make or your own server." className="py-8" />}
        {deliveries.length ? (
          <div className="border-t border-line">
            <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Recent deliveries</p>
            <ul className="divide-y divide-line">
              {deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-xs">
                  <Badge tone={d.status === "success" ? "success" : "danger"}>{d.status}</Badge>
                  <span className="font-mono">{d.event}</span>
                  <span className="text-muted">→ {d.webhook.name}</span>
                  <span className="text-muted">{d.responseCode ? `HTTP ${d.responseCode}` : d.error} · {d.attempts} attempt(s) · {d.durationMs} ms</span>
                  <span className="ml-auto text-muted">{fmtDateTime(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Developer reference" />
        <CardBody className="space-y-5 text-[13px]">
          <Section title="Connect your Digi Help Media CRM (n8n webhook)" body={`In the CRM: Settings → n8n webhooks → add URL:\n${base}/api/integrations/crm/webhook\nHeader: Authorization: Bearer <API key with clients:write>\nEvents: lead.status_changed (leads whose status contains “Converted” become clients; others are ignored).`} />
          <Section title="Create or update a client" body={`curl -X POST ${base}/api/v1/clients \\\n  -H "Authorization: Bearer dhm_…" -H "Content-Type: application/json" \\\n  -d '{"externalId":"CRM-123","name":"Acme Foods","email":"owner@acme.in","phone":"+919800000000","services":["Meta Ads"]}'`} />
          <Section title="Read data (pagination & incremental sync)" body={`GET ${base}/api/v1/{clients|quotes|invoices|payments|transactions|projects|tasks|vendors|bills|subscriptions}?limit=50&offset=0&updatedSince=2026-11-01T00:00:00Z\nGET ${base}/api/v1/summary?period=this_month   (scope reports:read)`} />
          <Section title="Verify a webhook signature (Node.js)" body={`const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");\nconst valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(req.headers["x-dhm-signature"]));`} />
          <Notice>Inbound API calls never bypass validation: clients are de-duplicated by CRM ID, email and phone, and every change is written to the audit log.</Notice>
        </CardBody>
      </Card>
    </>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><p className="font-semibold">{title}</p><CopyButton text={body} size="sm" variant="ghost" /></div>
      <pre className="thin-scroll overflow-x-auto whitespace-pre rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed">{body}</pre>
    </div>
  );
}
