import { NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/integrations";
import { upsertClientFromCrm } from "@/lib/crm-sync";

export const runtime = "nodejs";

// Receives events from the Digi Help Media CRM (its n8n webhook feature) or any
// automation tool. Converted leads become clients; other events are acknowledged
// and ignored, so the CRM can send everything to one URL.
//   POST /api/integrations/crm/webhook   Authorization: Bearer dhm_…  (scope clients:write)
//   Body: { "event": "lead.status_changed", "lead": { "id": "...", "full_name": "...", "status": "Converted", ... } }
//      or a flat client/lead object.
const CONVERTED = /convert|won|closed[-_ ]?won|client|customer|onboard/i;

export async function POST(req: Request) {
  const auth = await authenticateApiKey(req, "clients:write");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const event = typeof body.event === "string" ? body.event : "client.upsert";
  const lead = (body.lead ?? body.client ?? body.data ?? body) as Record<string, unknown>;
  const status = String(lead.status ?? lead.status_name ?? "");
  const shouldSync = event === "client.upsert" || event === "client.created" || CONVERTED.test(status) || new URL(req.url).searchParams.get("all") === "1";
  if (!shouldSync) return NextResponse.json({ ok: true, ignored: true, reason: `Event ${event} with status “${status}” is not a converted client` }, { status: 202 });
  try {
    const r = await upsertClientFromCrm({ ...lead, source: (lead.source as string) ?? "dhm-crm" }, auth.key.name);
    return NextResponse.json({ ok: true, clientId: r.client.id, created: r.created });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 422 });
  }
}
