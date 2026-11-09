"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { emitEvent } from "@/lib/integrations";
import { email, gstin, optDate, optStr, pan, phone, reqStr, stateCode } from "@/lib/validators";
import { stateName } from "@/lib/gst";

const clientSchema = z.object({
  name: reqStr("Client name", 150),
  businessName: optStr(200),
  contactPerson: optStr(150),
  email,
  phone,
  gstin,
  pan,
  billingAddress: optStr(500),
  city: optStr(80),
  stateCode,
  pincode: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{6}$/, "PIN code must be 6 digits").optional()).transform((v) => v ?? null),
  country: z.preprocess((v) => (v === "" || v == null ? "India" : v), z.string().max(60)),
  status: z.enum(["ACTIVE", "INACTIVE", "CHURNED"]).default("ACTIVE"),
  acquiredAt: optDate(),
  acquisitionChannel: optStr(80),
  notes: optStr(3000),
});

export async function saveClient(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const input = clientSchema.parse(formToObject(fd));
    if (input.gstin && input.stateCode && input.gstin.slice(0, 2) !== input.stateCode) {
      throw new ActionError("GSTIN state code does not match the selected state.", { gstin: "First 2 digits must match the state code" });
    }
    // Duplicate prevention on strong identifiers.
    const or = [
      input.email ? { email: { equals: input.email, mode: "insensitive" as const } } : null,
      input.gstin ? { gstin: input.gstin } : null,
      input.phone ? { phone: input.phone } : null,
    ].filter(Boolean) as object[];
    if (or.length) {
      const dup = await db.client.findFirst({ where: { deletedAt: null, OR: or, ...(id ? { NOT: { id } } : {}) } });
      if (dup) throw new ActionError(`A client with the same email, phone or GSTIN already exists: ${dup.name}.`);
    }
    const data = { ...input, state: stateName(input.stateCode) ?? null };
    if (id) {
      const before = await db.client.findUniqueOrThrow({ where: { id } });
      await db.client.update({ where: { id }, data });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Client", entityId: id, summary: `Client ${input.name} updated`, changes: diff(before, data) });
      emitEvent("client.updated", { id, ...data });
    } else {
      const c = await db.client.create({ data });
      id = c.id;
      await audit({ userId: user.id, action: "CREATE", entityType: "Client", entityId: c.id, summary: `Client ${input.name} created` });
      emitEvent("client.created", c);
    }
    revalidatePath("/billing/clients");
    return { ok: true, message: "Client saved", id };
  });
}

export async function archiveClient(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "FULL");
    const open = await db.invoice.count({ where: { clientId: id, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, deletedAt: null } });
    if (open) throw new ActionError(`This client has ${open} unpaid invoice(s). Settle or cancel them before archiving.`);
    const c = await db.client.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
    await audit({ userId: user.id, action: "ARCHIVE", entityType: "Client", entityId: id, summary: `Client ${c.name} archived` });
    revalidatePath("/billing/clients");
    return { ok: true, message: "Client archived", redirectTo: "/billing/clients" };
  });
}

export async function restoreClient(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "FULL");
    const c = await db.client.update({ where: { id }, data: { deletedAt: null, status: "ACTIVE" } });
    await audit({ userId: user.id, action: "RESTORE", entityType: "Client", entityId: id, summary: `Client ${c.name} restored` });
    revalidatePath("/billing/clients");
    return { ok: true, message: "Client restored" };
  });
}
