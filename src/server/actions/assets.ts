"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { emitEvent } from "@/lib/integrations";
import { addMonths } from "@/lib/dates";
import { checkbox, dateStr, money, optDate, optId, optInt, optMoney, optStr, reqStr } from "@/lib/validators";
import { systemCategory } from "@/server/services/billing";

const CYCLE_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12, BIENNIAL: 24 } as const;

function revalidateAssets() {
  revalidatePath("/subscriptions");
  revalidatePath("/assets", "layout");
  revalidatePath("/dashboard");
}

const subSchema = z.object({
  name: reqStr("Name", 120),
  provider: optStr(120),
  vendorId: optId,
  kind: z.enum(["SOFTWARE", "HOSTING", "DOMAIN", "AI_TOOL", "MARKETING_TOOL", "SERVICE", "OTHER"]),
  planName: optStr(120),
  billingCycle: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "BIENNIAL"]),
  cost: money("Cost per cycle"),
  originalCurrency: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[A-Z]{3}$/, "3-letter code").optional()).transform((v) => v ?? null),
  originalAmount: optMoney("Original amount"),
  startDate: optDate(),
  renewalDate: dateStr("Renewal date"),
  paymentMethod: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["BANK_TRANSFER", "UPI", "CASH", "CHEQUE", "CARD", "PAYMENT_GATEWAY", "OTHER"]).optional()).transform((v) => v ?? null),
  accountId: optId,
  categoryId: optId,
  autoRenew: checkbox,
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"]),
  domainName: optStr(200),
  seats: optInt(0, 100000),
  notes: optStr(2000),
});

export async function saveSubscription(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("assets", "EDIT");
    const input = subSchema.parse(formToObject(fd));
    const data = { ...input, cancelledAt: input.status === "CANCELLED" ? new Date() : null };
    if (id) {
      const before = await db.subscription.findUniqueOrThrow({ where: { id } });
      await db.subscription.update({ where: { id }, data: { ...data, cancelledAt: input.status === "CANCELLED" ? (before.cancelledAt ?? new Date()) : null } });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Subscription", entityId: id, summary: `Subscription ${input.name} updated`, changes: diff(before, input) });
    } else {
      const s = await db.subscription.create({ data });
      await audit({ userId: user.id, action: "CREATE", entityType: "Subscription", entityId: s.id, summary: `Subscription ${input.name} added (₹${input.cost}/${input.billingCycle.toLowerCase()})` });
    }
    revalidateAssets();
    return { ok: true, message: "Subscription saved" };
  });
}

const renewSchema = z.object({
  date: dateStr("Payment date"),
  amount: money("Amount paid", { allowZero: false }),
  taxAmount: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("Input GST")),
  accountId: z.string().min(1, "Select an account"),
  reference: optStr(120),
});

/** Record a renewal payment: creates the expense and moves the renewal date one cycle ahead. */
export async function renewSubscription(id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("assets", "EDIT");
    const input = renewSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      const s = await tx.subscription.findUniqueOrThrow({ where: { id } });
      const account = await tx.account.findUniqueOrThrow({ where: { id: input.accountId } });
      if (input.date < account.openingDate) throw new ActionError(`Date is before the opening date of ${account.name}.`);
      const category = s.categoryId
        ? { id: s.categoryId }
        : await systemCategory(tx, s.kind === "DOMAIN" || s.kind === "HOSTING" ? "Hosting & Domains" : "Software Subscriptions", "EXPENSE", "OPERATING_EXPENSE");
      await tx.transaction.create({
        data: {
          type: "EXPENSE", date: input.date, amount: input.amount, taxAmount: input.taxAmount, description: `${s.name} renewal${s.planName ? ` (${s.planName})` : ""}`,
          reference: input.reference, method: s.paymentMethod, accountId: input.accountId, categoryId: category.id, vendorId: s.vendorId, subscriptionId: s.id, createdById: user.id,
        },
      });
      const next = addMonths(s.renewalDate, CYCLE_MONTHS[s.billingCycle]);
      await tx.subscription.update({ where: { id }, data: { renewalDate: next, status: "ACTIVE" } });
      emitEvent("subscription.renewed", { id, name: s.name, amount: input.amount, nextRenewal: next });
      await audit({ userId: user.id, action: "RENEW", entityType: "Subscription", entityId: id, summary: `${s.name} renewed for ₹${input.amount}; next renewal ${next.toISOString().slice(0, 10)}` }, tx);
    });
    revalidateAssets();
    revalidatePath("/finance", "layout");
    return { ok: true, message: "Renewal recorded" };
  });
}

export async function deleteSubscription(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("assets", "FULL");
    const s = await db.subscription.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Subscription", entityId: id, summary: `Subscription ${s.name} deleted` });
    revalidateAssets();
    return { ok: true, message: "Subscription deleted" };
  });
}

// ───────── Assets ─────────

const assetSchema = z.object({
  name: reqStr("Asset name", 150),
  category: z.enum(["LAPTOP", "DESKTOP", "CAMERA", "MOBILE", "OFFICE_EQUIPMENT", "FURNITURE", "OTHER"]),
  brand: optStr(80),
  model: optStr(80),
  serialNumber: optStr(100),
  purchaseDate: optDate(),
  purchaseValue: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("Purchase value")),
  vendorId: optId,
  warrantyUntil: optDate(),
  status: z.enum(["IN_USE", "IN_STOCK", "UNDER_REPAIR", "RETIRED", "LOST", "SOLD"]),
  assignedEmployeeId: optId,
  location: optStr(120),
  notes: optStr(2000),
});

export async function saveAsset(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("assets", "EDIT");
    const input = assetSchema.parse(formToObject(fd));
    let assetId = id;
    if (id) {
      const before = await db.asset.findUniqueOrThrow({ where: { id } });
      await db.asset.update({ where: { id }, data: input });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Asset", entityId: id, summary: `Asset ${input.name} updated`, changes: diff(before, input) });
    } else {
      const a = await db.asset.create({ data: input });
      assetId = a.id;
      await audit({ userId: user.id, action: "CREATE", entityType: "Asset", entityId: a.id, summary: `Asset ${input.name} added` });
    }
    revalidateAssets();
    return { ok: true, message: "Asset saved", redirectTo: id ? undefined : `/assets/${assetId}` };
  });
}

export async function archiveAsset(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("assets", "FULL");
    const a = await db.asset.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Asset", entityId: id, summary: `Asset ${a.name} removed` });
    revalidateAssets();
    return { ok: true, message: "Asset removed", redirectTo: "/assets" };
  });
}

const maintSchema = z.object({
  date: dateStr("Date"),
  description: reqStr("Description", 300),
  cost: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("Cost")),
  vendorId: optId,
  nextDueDate: optDate(),
});

export async function addMaintenance(assetId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("assets", "EDIT");
    const input = maintSchema.parse(formToObject(fd));
    await db.assetMaintenance.create({ data: { ...input, assetId } });
    await audit({ userId: user.id, action: "MAINTENANCE", entityType: "Asset", entityId: assetId, summary: `Maintenance logged: ${input.description}` });
    revalidateAssets();
    return { ok: true, message: "Maintenance logged. Record the payment in Finance if it was paid." };
  });
}

export async function deleteMaintenance(id: string): Promise<ActionState> {
  return run(async () => {
    await requireActionAccess("assets", "FULL");
    await db.assetMaintenance.delete({ where: { id } });
    revalidateAssets();
    return { ok: true, message: "Entry deleted" };
  });
}
