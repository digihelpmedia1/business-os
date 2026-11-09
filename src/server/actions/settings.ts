"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { checkbox, email, gstin, money, optStr, pan, percent, phone, reqStr, stateCode } from "@/lib/validators";
import { stateName } from "@/lib/gst";
import { storeUpload } from "@/lib/storage";
import { ACCESS_LEVELS, MODULES } from "@/lib/permissions";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { toDateOnly, todayIST } from "@/lib/dates";
import { formatNumber } from "@/lib/numbering-defaults";
import { API_SCOPES, WEBHOOK_EVENTS, hashApiKey, sendTestEvent } from "@/lib/integrations";

function revalidateAll() {
  revalidatePath("/", "layout");
}

// ───────── Company profile & GST ─────────

const companySchema = z.object({
  companyName: reqStr("Company name", 120),
  legalName: optStr(200),
  tagline: optStr(200),
  email,
  phone,
  website: optStr(200),
  addressLine1: optStr(200),
  addressLine2: optStr(200),
  city: optStr(80),
  stateCode,
  pincode: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{6}$/, "6-digit PIN").optional()).transform((v) => v ?? null),
  gstRegistered: checkbox,
  gstin,
  pan,
  cin: optStr(30),
  lutNumber: optStr(40),
  bankName: optStr(100),
  bankAccountName: optStr(120),
  bankAccountNumber: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{6,20}$/, "Digits only").optional()).transform((v) => v ?? null),
  bankIfsc: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v), z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC").optional()).transform((v) => v ?? null),
  bankBranch: optStr(100),
  upiId: optStr(80),
  signatoryName: optStr(100),
  signatoryDesignation: optStr(100),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Hex colour"),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Hex colour"),
  fyStartMonth: z.coerce.number().int().min(1).max(12),
  defaultDueDays: z.coerce.number().int().min(0).max(180),
  quoteValidityDays: z.coerce.number().int().min(1).max(365),
  salaryPayDay: z.coerce.number().int().min(1).max(28),
  roundOffTotals: checkbox,
  defaultInvoiceTerms: optStr(5000),
  defaultQuoteTerms: optStr(10000),
  invoiceFooter: optStr(500),
});

export async function saveCompany(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "FULL");
    const raw = formToObject(fd);
    const logo = raw.logo instanceof File && raw.logo.size > 0 ? raw.logo : null;
    delete raw.logo;
    const input = companySchema.parse(raw);
    if (input.gstRegistered && !input.gstin) throw new ActionError("Enter your GSTIN, or untick “GST registered”.", { gstin: "Required when GST-registered" });
    if (input.gstin && input.stateCode && input.gstin.slice(0, 2) !== input.stateCode) throw new ActionError("GSTIN state code doesn't match the selected state.", { gstin: "First 2 digits must match the state" });
    if (input.gstin && input.pan && input.gstin.slice(2, 12) !== input.pan) throw new ActionError("PAN doesn't match the PAN inside your GSTIN.", { pan: "Must match GSTIN characters 3–12" });
    const before = await db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    let logoFileId = before.logoFileId;
    if (logo) logoFileId = (await storeUpload(logo, user.id, { imagesOnly: true })).id;
    const data = { ...input, state: stateName(input.stateCode), logoFileId };
    await db.companySettings.update({ where: { id: 1 }, data });
    await audit({ userId: user.id, action: "UPDATE", entityType: "Settings", entityId: "company", summary: "Company settings updated", changes: diff(before, data) });
    revalidateAll();
    return { ok: true, message: "Company settings saved" };
  });
}

export async function removeLogo(): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "FULL");
    await db.companySettings.update({ where: { id: 1 }, data: { logoFileId: null } });
    await audit({ userId: user.id, action: "UPDATE", entityType: "Settings", entityId: "company", summary: "Company logo removed" });
    revalidateAll();
    return { ok: true, message: "Logo removed" };
  });
}

// ───────── Numbering ─────────

export async function saveSeries(docType: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "FULL");
    const input = z.object({
      prefix: z.string().trim().min(1, "Prefix is required").max(10).regex(/^[A-Za-z0-9-]+$/, "Letters, digits and hyphen only"),
      padding: z.coerce.number().int().min(3).max(6),
      includeFy: checkbox,
    }).parse(formToObject(fd));
    const sample = formatNumber(input.prefix, input.includeFy ? "26-27" : null, 1, input.padding);
    if (["TAX_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE", "NON_GST"].includes(docType) && sample.length > 16) {
      throw new ActionError(`Numbers like “${sample}” exceed GST's 16-character limit. Use a shorter prefix or padding.`, { prefix: "Too long for GST" });
    }
    await db.documentSeries.upsert({ where: { docType }, create: { docType, ...input }, update: input });
    await audit({ userId: user.id, action: "UPDATE", entityType: "Settings", entityId: `series:${docType}`, summary: `Numbering for ${docType} set to ${sample}` });
    revalidatePath("/settings/numbering");
    return { ok: true, message: `Next numbers will look like ${sample}` };
  });
}

// ───────── Tax rates ─────────

export async function saveTaxRate(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "FULL");
    const input = z.object({ name: reqStr("Name", 60), rate: percent("Rate"), isDefault: checkbox, isActive: checkbox }).parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      if (input.isDefault) await tx.taxRate.updateMany({ data: { isDefault: false } });
      if (id) await tx.taxRate.update({ where: { id }, data: input });
      else await tx.taxRate.create({ data: input });
    });
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "TaxRate", entityId: id ?? undefined, summary: `Tax rate ${input.name} (${input.rate}%) saved` });
    revalidatePath("/settings/taxes");
    return { ok: true, message: "Tax rate saved" };
  });
}

export async function deleteTaxRate(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "FULL");
    const t = await db.taxRate.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: "TaxRate", entityId: id, summary: `Tax rate ${t.name} deleted` });
    revalidatePath("/settings/taxes");
    return { ok: true, message: "Tax rate deleted (existing documents keep their rates)" };
  });
}

// ───────── Services catalog ─────────

export async function saveService(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "EDIT");
    const input = z.object({
      name: reqStr("Service name", 120),
      category: optStr(80),
      description: optStr(2000),
      sacCode: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4,8}$/, "4–8 digit SAC/HSN").optional()).transform((v) => v ?? null),
      unit: reqStr("Unit", 20),
      defaultPrice: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("Default price")),
      defaultTaxRate: percent("Default GST rate"),
      isActive: checkbox,
    }).parse(formToObject(fd));
    if (id) await db.service.update({ where: { id }, data: input });
    else await db.service.create({ data: input });
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "Service", entityId: id ?? undefined, summary: `Service ${input.name} saved` });
    revalidatePath("/settings/services");
    return { ok: true, message: "Service saved" };
  });
}

// ───────── Document templates ─────────

const templateSchema = z.object({
  name: reqStr("Template name", 100),
  kind: z.enum(["PROPOSAL", "QUOTATION", "ESTIMATE"]),
  serviceId: z.string().optional().transform((v) => v || null),
  title: optStr(200),
  introduction: optStr(5000),
  scopeOfWork: optStr(10000),
  deliverables: optStr(10000),
  timeline: optStr(5000),
  paymentTerms: optStr(3000),
  terms: optStr(10000),
  itemDescription: optStr(300),
  itemPrice: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("Price")),
  itemUnit: optStr(20),
  isActive: checkbox,
});

export async function saveTemplate(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "EDIT");
    const { itemDescription, itemPrice, itemUnit, ...input } = templateSchema.parse(formToObject(fd));
    const service = input.serviceId ? await db.service.findUnique({ where: { id: input.serviceId } }) : null;
    const items = itemDescription
      ? [{ serviceId: input.serviceId, description: itemDescription, details: "", sacCode: service?.sacCode ?? "", unit: itemUnit ?? service?.unit ?? "", quantity: "1", unitPrice: itemPrice, discountPercent: "0", taxRate: service ? String(Number(service.defaultTaxRate)) : "0" }]
      : [];
    const data = { ...input, items };
    if (id) await db.documentTemplate.update({ where: { id }, data });
    else await db.documentTemplate.create({ data });
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "Template", entityId: id ?? undefined, summary: `Template ${input.name} saved` });
    revalidatePath("/settings/templates");
    return { ok: true, message: "Template saved" };
  });
}

export async function deleteTemplate(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "FULL");
    const t = await db.documentTemplate.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Template", entityId: id, summary: `Template ${t.name} deleted` });
    revalidatePath("/settings/templates");
    return { ok: true, message: "Template deleted" };
  });
}

// ───────── Currencies (display conversion) ─────────

export async function saveRate(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "EDIT");
    const input = z.object({
      currency: z.enum(SUPPORTED_CURRENCIES.filter((c) => c !== "INR") as [string, ...string[]]),
      rateToInr: z.coerce.number({ error: "Enter a rate" }).positive("Rate must be positive").max(1_000_000),
    }).parse(formToObject(fd));
    await db.exchangeRate.upsert({
      where: { currency: input.currency },
      create: { currency: input.currency, rateToInr: input.rateToInr.toFixed(6), source: "manual", asOf: todayIST() },
      update: { rateToInr: input.rateToInr.toFixed(6), source: "manual", asOf: todayIST() },
    });
    await audit({ userId: user.id, action: "UPDATE", entityType: "ExchangeRate", entityId: input.currency, summary: `1 ${input.currency} = ₹${input.rateToInr} (manual)` });
    revalidateAll();
    return { ok: true, message: `${input.currency} rate saved` };
  });
}

export async function refreshRates(): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("settings", "EDIT");
    const res = await fetch("https://api.frankfurter.app/latest?from=INR", { signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => null);
    if (!res?.ok) throw new ActionError("Couldn't reach the ECB rates service. Try again or enter rates manually.");
    const data = (await res.json()) as { date: string; rates: Record<string, number> };
    const asOf = toDateOnly(data.date);
    let n = 0;
    for (const [currency, perInr] of Object.entries(data.rates)) {
      if (!(perInr > 0)) continue;
      await db.exchangeRate.upsert({
        where: { currency },
        create: { currency, rateToInr: (1 / perInr).toFixed(6), source: "ecb", asOf },
        update: { rateToInr: (1 / perInr).toFixed(6), source: "ecb", asOf },
      });
      n++;
    }
    await audit({ userId: user.id, action: "UPDATE", entityType: "ExchangeRate", summary: `${n} rates refreshed from ECB (${data.date})` });
    revalidateAll();
    return { ok: true, message: `${n} exchange rates updated (ECB reference rates of ${data.date})` };
  });
}

export async function deleteRate(currency: string): Promise<ActionState> {
  return run(async () => {
    await requireActionAccess("settings", "FULL");
    await db.exchangeRate.delete({ where: { currency } });
    revalidateAll();
    return { ok: true, message: `${currency} removed from the currency switcher` };
  });
}

// ───────── Users ─────────

const userSchema = z.object({
  name: reqStr("Name", 100),
  email: z.string().trim().toLowerCase().email("Valid email required"),
  roleId: z.string().min(1, "Select a role"),
  isActive: checkbox,
  password: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(10, "At least 10 characters").max(128).regex(/[A-Za-z]/, "Include a letter").regex(/\d/, "Include a number").optional()),
  mustChangePassword: checkbox,
  employeeId: z.string().optional().transform((v) => v || null),
});

export async function saveUser(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await requireActionAccess("users", "FULL");
    const input = userSchema.parse(formToObject(fd));
    const role = await db.role.findUniqueOrThrow({ where: { id: input.roleId } });
    if (!id && !input.password) throw new ActionError("Set an initial password for the new user.", { password: "Required for new users" });
    if (id === actor.id && (!input.isActive || role.id !== actor.roleId)) throw new ActionError("You can't deactivate yourself or change your own role.");
    if (id) {
      const before = await db.user.findUniqueOrThrow({ where: { id }, include: { role: true } });
      if (before.role.name === "Admin" && before.role.isSystem && (role.name !== "Admin" || !input.isActive)) {
        const admins = await db.user.count({ where: { isActive: true, role: { name: "Admin", isSystem: true } } });
        if (admins <= 1) throw new ActionError("At least one active Admin is required.");
      }
    }
    const dup = await db.user.findFirst({ where: { email: input.email, ...(id ? { NOT: { id } } : {}) } });
    if (dup) throw new ActionError("Another user already uses this email.", { email: "Already in use" });
    const userId = await db.$transaction(async (tx) => {
      let uid = id;
      const base = { name: input.name, email: input.email, roleId: input.roleId, isActive: input.isActive, mustChangePassword: input.mustChangePassword };
      if (id) {
        const before = await tx.user.findUniqueOrThrow({ where: { id } });
        await tx.user.update({
          where: { id },
          data: {
            ...base,
            ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12), failedLogins: 0, lockedUntil: null } : {}),
            // Sign the user out everywhere when access changes or password is reset.
            ...(input.password || before.roleId !== input.roleId || !input.isActive ? { tokenVersion: { increment: 1 } } : {}),
          },
        });
        await audit({ userId: actor.id, action: "UPDATE", entityType: "User", entityId: id, summary: `User ${input.email} updated (role ${role.name}${input.password ? ", password reset" : ""}${!input.isActive ? ", deactivated" : ""})` }, tx);
      } else {
        const u = await tx.user.create({ data: { ...base, passwordHash: await bcrypt.hash(input.password!, 12) } });
        uid = u.id;
        await audit({ userId: actor.id, action: "CREATE", entityType: "User", entityId: u.id, summary: `User ${input.email} created with role ${role.name}` }, tx);
      }
      await tx.employee.updateMany({ where: { userId: uid }, data: { userId: null } });
      if (input.employeeId) await tx.employee.update({ where: { id: input.employeeId }, data: { userId: uid } });
      return uid!;
    });
    revalidatePath("/settings/users");
    return { ok: true, message: "User saved", id: userId };
  });
}

// ───────── Roles & access levels ─────────

export async function saveRole(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await requireActionAccess("users", "FULL");
    const name = z.string().trim().min(2, "Role name is required").max(50).parse(fd.get("name"));
    const description = (fd.get("description") as string | null)?.trim().slice(0, 300) || null;
    const levels = Object.fromEntries(MODULES.map((m) => {
      const v = fd.get(`level_${m.key}`);
      return [m.key, ACCESS_LEVELS.includes(v as never) ? (v as (typeof ACCESS_LEVELS)[number]) : "NONE"];
    }));
    if (id) {
      const role = await db.role.findUniqueOrThrow({ where: { id } });
      if (role.isSystem) throw new ActionError("The Admin role always has full access and can't be edited.");
    }
    const permissions = await db.permission.findMany();
    const roleId = await db.$transaction(async (tx) => {
      const role = id
        ? await tx.role.update({ where: { id }, data: { name, description } })
        : await tx.role.create({ data: { name, description } });
      for (const p of permissions) {
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
          create: { roleId: role.id, permissionId: p.id, level: levels[p.key] ?? "NONE" },
          update: { level: levels[p.key] ?? "NONE" },
        });
      }
      await audit({ userId: actor.id, action: id ? "UPDATE" : "CREATE", entityType: "Role", entityId: role.id, summary: `Role ${name} saved`, changes: levels }, tx);
      return role.id;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Role saved — changes apply on the users' next page load", redirectTo: `/settings/roles?role=${roleId}` };
  });
}

export async function deleteRole(id: string): Promise<ActionState> {
  return run(async () => {
    const actor = await requireActionAccess("users", "FULL");
    const role = await db.role.findUniqueOrThrow({ where: { id }, include: { _count: { select: { users: true } } } });
    if (role.isSystem) throw new ActionError("System roles can't be deleted.");
    if (role._count.users) throw new ActionError(`${role._count.users} user(s) still have this role. Move them to another role first.`);
    await db.role.delete({ where: { id } });
    await audit({ userId: actor.id, action: "DELETE", entityType: "Role", entityId: id, summary: `Role ${role.name} deleted` });
    revalidatePath("/settings/roles");
    return { ok: true, message: "Role deleted", redirectTo: "/settings/roles" };
  });
}

// ───────── Integrations: API keys & webhooks ─────────

export async function createApiKey(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await requireActionAccess("settings", "FULL");
    const name = z.string().trim().min(2, "Name the key").max(80).parse(fd.get("name"));
    const scopes = API_SCOPES.map((s) => s.scope).filter((s) => fd.get(`scope_${s}`) === "on");
    if (!scopes.length) throw new ActionError("Choose at least one permission for this key.");
    const raw = `dhm_${randomBytes(24).toString("base64url")}`;
    await db.apiKey.create({ data: { name, prefix: raw.slice(0, 10), keyHash: hashApiKey(raw), scopes, createdById: actor.id } });
    await audit({ userId: actor.id, action: "CREATE", entityType: "ApiKey", summary: `API key “${name}” created (${scopes.join(", ")})` });
    revalidatePath("/settings/integrations");
    return { ok: true, message: `Copy this key now — it won't be shown again: ${raw}` };
  });
}

export async function revokeApiKey(id: string): Promise<ActionState> {
  return run(async () => {
    const actor = await requireActionAccess("settings", "FULL");
    const k = await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit({ userId: actor.id, action: "REVOKE", entityType: "ApiKey", entityId: id, summary: `API key “${k.name}” revoked` });
    revalidatePath("/settings/integrations");
    return { ok: true, message: "Key revoked" };
  });
}

export async function saveWebhook(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await requireActionAccess("settings", "FULL");
    const name = z.string().trim().min(2, "Name is required").max(80).parse(fd.get("name"));
    const url = z.url("Enter a valid URL").refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", "Use an https:// URL").parse(String(fd.get("url") ?? "").trim());
    const all = fd.get("event_*") === "on";
    const events = all ? ["*"] : WEBHOOK_EVENTS.map((e) => e.event).filter((e) => fd.get(`event_${e}`) === "on");
    if (!events.length) throw new ActionError("Choose at least one event.");
    const isActive = fd.get("isActive") === "on";
    if (id) await db.webhook.update({ where: { id }, data: { name, url, events, isActive } });
    else await db.webhook.create({ data: { name, url, events, isActive, secret: `whsec_${randomBytes(24).toString("base64url")}`, createdById: actor.id } });
    await audit({ userId: actor.id, action: id ? "UPDATE" : "CREATE", entityType: "Webhook", entityId: id ?? undefined, summary: `Webhook “${name}” → ${new URL(url).host} (${events.join(", ")})` });
    revalidatePath("/settings/integrations");
    return { ok: true, message: "Webhook saved" };
  });
}

export async function deleteWebhook(id: string): Promise<ActionState> {
  return run(async () => {
    const actor = await requireActionAccess("settings", "FULL");
    const w = await db.webhook.delete({ where: { id } });
    await audit({ userId: actor.id, action: "DELETE", entityType: "Webhook", entityId: id, summary: `Webhook “${w.name}” deleted` });
    revalidatePath("/settings/integrations");
    return { ok: true, message: "Webhook deleted" };
  });
}

export async function testWebhook(id: string): Promise<ActionState> {
  return run(async () => {
    await requireActionAccess("settings", "FULL");
    const ok = await sendTestEvent(id);
    revalidatePath("/settings/integrations");
    return ok ? { ok: true, message: "Test event delivered" } : { ok: false, message: "Delivery failed — see the delivery log" };
  });
}
