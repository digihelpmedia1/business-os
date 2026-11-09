import "server-only";
import { z } from "zod";
import { db } from "./db";
import { audit } from "./audit";
import { emitEvent } from "./integrations";
import { toDateOnly, todayIST } from "./dates";
import { GSTIN_REGEX } from "./gst";

// Accepts the field names used by the Digi Help Media CRM / Meta lead forms as well as
// plain names, so the CRM (or n8n / Zapier / Make) can push clients without mapping.
export const crmClientSchema = z
  .object({
    externalId: z.coerce.string().trim().min(1).max(120).optional(),
    id: z.coerce.string().trim().max(120).optional(),
    client_id: z.coerce.string().trim().max(120).optional(),
    source: z.string().trim().max(40).optional(),
    name: z.string().trim().max(150).optional(),
    full_name: z.string().trim().max(150).optional(),
    businessName: z.string().trim().max(200).optional(),
    business_name: z.string().trim().max(200).optional(),
    company: z.string().trim().max(200).optional(),
    company_name: z.string().trim().max(200).optional(),
    email: z.string().trim().max(200).optional(),
    phone: z.coerce.string().trim().max(30).optional(),
    phone_number: z.coerce.string().trim().max(30).optional(),
    gstin: z.string().trim().max(20).optional(),
    city: z.string().trim().max(80).optional(),
    service: z.string().trim().max(200).optional(),
    services: z.union([z.string(), z.array(z.string())]).optional(),
    campaign_name: z.string().trim().max(200).optional(),
    platform: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(3000).optional(),
    status: z.string().trim().max(60).optional(),
    acquiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  })
  .passthrough();

export type CrmClientInput = z.infer<typeof crmClientSchema>;

export async function upsertClientFromCrm(raw: unknown, apiKeyName: string) {
  const input = crmClientSchema.parse(raw);
  const externalCrmId = input.externalId ?? input.client_id ?? input.id;
  const name = input.name ?? input.full_name;
  if (!externalCrmId) throw new Error("externalId (or id / client_id) is required to avoid duplicate clients.");
  if (!name) throw new Error("name (or full_name) is required.");
  const crmSource = (input.source ?? "dhm-crm").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const email = input.email && /^\S+@\S+\.\S+$/.test(input.email) ? input.email.toLowerCase() : null;
  const phone = (input.phone ?? input.phone_number)?.replace(/[^\d+]/g, "") || null;
  const gstin = input.gstin && GSTIN_REGEX.test(input.gstin.toUpperCase()) ? input.gstin.toUpperCase() : null;
  const services = Array.isArray(input.services) ? input.services.join(", ") : (input.services ?? input.service);
  const noteParts = [
    services ? `Services (CRM): ${services}` : null,
    input.campaign_name ? `Campaign: ${input.campaign_name}` : null,
    input.platform ? `Platform: ${input.platform}` : null,
    input.notes ?? null,
  ].filter(Boolean);
  const data = {
    name,
    businessName: input.businessName ?? input.business_name ?? input.company ?? input.company_name ?? null,
    email,
    phone,
    gstin,
    city: input.city ?? null,
    acquisitionChannel: input.platform ?? input.campaign_name ? `CRM: ${input.platform ?? input.campaign_name}` : "CRM",
    crmSyncedAt: new Date(),
  };
  // Match by CRM id first, then by email / phone so manually-created clients get linked, not duplicated.
  const existing =
    (await db.client.findUnique({ where: { crmSource_externalCrmId: { crmSource, externalCrmId } } })) ??
    (email || phone
      ? await db.client.findFirst({ where: { deletedAt: null, externalCrmId: null, OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } })
      : null);
  if (existing) {
    const updated = await db.client.update({
      where: { id: existing.id },
      data: {
        ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined)),
        externalCrmId,
        crmSource,
        deletedAt: null,
        notes: noteParts.length && !existing.notes ? noteParts.join("\n") : existing.notes,
      },
    });
    await audit({ action: "CRM_SYNC", entityType: "Client", entityId: updated.id, summary: `Client ${updated.name} updated from CRM via “${apiKeyName}”` });
    emitEvent("client.updated", updated);
    return { client: updated, created: false };
  }
  const created = await db.client.create({
    data: {
      ...data,
      externalCrmId,
      crmSource,
      status: "ACTIVE",
      acquiredAt: input.acquiredAt ? toDateOnly(input.acquiredAt.slice(0, 10)) : todayIST(),
      notes: noteParts.join("\n") || null,
    },
  });
  await audit({ action: "CRM_SYNC", entityType: "Client", entityId: created.id, summary: `Client ${created.name} created from CRM via “${apiKeyName}”` });
  emitEvent("client.created", created);
  return { client: created, created: true };
}
