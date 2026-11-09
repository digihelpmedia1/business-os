"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/integrations";
import { can } from "@/lib/permissions";
import { addMonths, isoDate, toDateOnly } from "@/lib/dates";
import { checkbox, optStr, reqId } from "@/lib/validators";
import {
  cancelInvoice, convertAdvanceToInvoice, convertQuoteToInvoice, createInvoice, createQuote, duplicateQuote, invoiceSchema, issueInvoice,
  itemSchema, newShareToken, quoteSchema, recordPayment, setQuoteStatus, updateDraftInvoice, updateQuote, voidPayment,
} from "@/server/services/billing";

function revalidateBilling() {
  revalidatePath("/billing", "layout");
  revalidatePath("/dashboard");
}

// ───────── Quotes ─────────

export async function saveQuote(id: string | null, raw: unknown): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const input = quoteSchema.parse(raw);
    const quote = await db.$transaction((tx) => (id ? updateQuote(tx, id, input, user.id) : createQuote(tx, input, user.id)));
    revalidateBilling();
    return { ok: true, message: id ? "Document updated" : `${quote.number} created`, redirectTo: `/billing/quotes/${quote.id}` };
  });
}

export async function changeQuoteStatus(id: string, status: "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "DRAFT"): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    await db.$transaction((tx) => setQuoteStatus(tx, id, status, user.id));
    const q = await db.quote.findUnique({ where: { id }, select: { id: true, number: true, title: true, kind: true, status: true, total: true, clientId: true } });
    emitEvent("quote.status_changed", q);
    revalidateBilling();
    return { ok: true, message: `Marked as ${status.toLowerCase()}` };
  });
}

export async function copyQuote(id: string, asVersion: boolean): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const copy = await db.$transaction((tx) => duplicateQuote(tx, id, user.id, asVersion));
    revalidateBilling();
    return { ok: true, message: asVersion ? `Version ${copy.version} created` : `Duplicated as ${copy.number}`, redirectTo: `/billing/quotes/${copy.id}/edit` };
  });
}

export async function quoteToInvoice(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const inv = await db.$transaction((tx) => convertQuoteToInvoice(tx, id, user.id));
    revalidateBilling();
    return { ok: true, message: "Draft invoice created — review and issue it.", redirectTo: `/billing/invoices/${inv.id}` };
  });
}

export async function toggleQuoteShare(id: string, enable: boolean): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const q = await db.quote.update({ where: { id }, data: { shareToken: enable ? newShareToken() : null } });
    await audit({ userId: user.id, action: enable ? "SHARE" : "UNSHARE", entityType: "Quote", entityId: id, summary: `${q.number} share link ${enable ? "created" : "revoked"}` });
    revalidatePath(`/billing/quotes/${id}`);
    return { ok: true, message: enable ? "Share link created" : "Share link revoked" };
  });
}

export async function deleteQuote(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "FULL");
    const q = await db.quote.findUniqueOrThrow({ where: { id } });
    if (q.convertedInvoiceId) throw new ActionError("This document was converted to an invoice and cannot be deleted.");
    await db.quote.update({ where: { id }, data: { deletedAt: new Date(), shareToken: null } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Quote", entityId: id, summary: `${q.number} deleted` });
    revalidateBilling();
    return { ok: true, message: "Document deleted", redirectTo: "/billing/quotes" };
  });
}

// ───────── Invoices ─────────

export async function saveInvoice(id: string | null, raw: unknown): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const { issue, ...rest } = z.object({ issue: z.boolean().default(false) }).passthrough().parse(raw);
    const input = invoiceSchema.parse(rest);
    if (issue && !can(user.access, "billing", "FULL") && !can(user.access, "billing", "EDIT")) throw new ActionError("You cannot issue invoices.");
    const inv = await db.$transaction(async (tx) => {
      const saved = id ? await updateDraftInvoice(tx, id, input, user.id) : await createInvoice(tx, input, user.id);
      return issue ? issueInvoice(tx, saved.id, user.id) : saved;
    });
    if (issue) emitEvent("invoice.issued", inv);
    revalidateBilling();
    return { ok: true, message: issue ? `Issued ${inv.number}` : "Draft saved", redirectTo: `/billing/invoices/${inv.id}` };
  });
}

export async function issueInvoiceAction(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const inv = await db.$transaction((tx) => issueInvoice(tx, id, user.id));
    emitEvent("invoice.issued", inv);
    revalidateBilling();
    return { ok: true, message: `Issued ${inv.number}` };
  });
}

export async function cancelInvoiceAction(id: string, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "FULL");
    const reason = z.string().trim().min(3, "Give a reason").max(500).parse(fd.get("reason"));
    await db.$transaction((tx) => cancelInvoice(tx, id, reason, user.id));
    emitEvent("invoice.cancelled", { id, reason });
    revalidateBilling();
    return { ok: true, message: "Invoice cancelled" };
  });
}

export async function deleteDraftInvoice(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== "DRAFT") throw new ActionError("Only drafts can be deleted. Cancel issued invoices instead.");
    await db.$transaction(async (tx) => {
      await tx.quote.updateMany({ where: { convertedInvoiceId: id }, data: { convertedInvoiceId: null } });
      await tx.invoice.delete({ where: { id } });
      await audit({ userId: user.id, action: "DELETE", entityType: "Invoice", entityId: id, summary: `Draft invoice for ${inv.clientName} deleted` }, tx);
    });
    revalidateBilling();
    return { ok: true, message: "Draft deleted", redirectTo: "/billing/invoices" };
  });
}

export async function convertAdvanceAction(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const inv = await db.$transaction((tx) => convertAdvanceToInvoice(tx, id, user.id));
    revalidateBilling();
    return { ok: true, message: `Converted to ${inv.number}`, redirectTo: `/billing/invoices/${inv.id}` };
  });
}

export async function markReminderSent(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const inv = await db.invoice.update({ where: { id }, data: { lastReminderAt: new Date() } });
    await audit({ userId: user.id, action: "REMINDER", entityType: "Invoice", entityId: id, summary: `Payment reminder sent for ${inv.number}` });
    revalidatePath(`/billing/invoices/${id}`);
    return { ok: true, message: "Reminder logged" };
  });
}

// ───────── Payments ─────────

export async function recordPaymentAction(invoiceId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const p = await db.$transaction((tx) => recordPayment(tx, { ...(formToObject(fd) as object), invoiceId } as never, user.id));
    emitEvent("payment.recorded", p);
    const after = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (after?.status === "PAID") emitEvent("invoice.paid", after);
    revalidateBilling();
    revalidatePath("/finance", "layout");
    return { ok: true, message: `Payment recorded — receipt ${p.receiptNumber}` };
  });
}

export async function voidPaymentAction(id: string, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "FULL");
    const reason = z.string().trim().min(3, "Give a reason").max(500).parse(fd.get("reason"));
    await db.$transaction((tx) => voidPayment(tx, id, reason, user.id));
    emitEvent("payment.voided", { id, reason });
    revalidateBilling();
    revalidatePath("/finance", "layout");
    return { ok: true, message: "Payment voided" };
  });
}

// ───────── Recurring invoices ─────────

const recurringSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  clientId: reqId("Client"),
  projectId: z.string().optional().transform((v) => v || null),
  invoiceType: z.enum(["TAX_INVOICE", "NON_GST", "PROFORMA"]),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date is required"),
  endDate: z.string().optional().transform((v) => (v ? v : null)),
  dueInDays: z.coerce.number().int().min(0).max(120),
  autoIssue: checkbox,
  isActive: checkbox,
  notes: optStr(1000),
  items: z.array(itemSchema).min(1, "Add at least one line item"),
});

export async function saveRecurring(id: string | null, raw: unknown): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const input = recurringSchema.parse(raw);
    const startDate = toDateOnly(input.startDate);
    const endDate = input.endDate ? toDateOnly(input.endDate) : null;
    if (endDate && endDate < startDate) throw new ActionError("End date must be after start date.", { endDate: "Before start date" });
    const data = {
      name: input.name, clientId: input.clientId, projectId: input.projectId, invoiceType: input.invoiceType, frequency: input.frequency,
      startDate, endDate, dueInDays: input.dueInDays, autoIssue: input.autoIssue, isActive: input.isActive, notes: input.notes,
      items: input.items,
    };
    if (id) {
      const existing = await db.recurringInvoice.findUniqueOrThrow({ where: { id } });
      const nextRunDate = existing.lastRunAt ? existing.nextRunDate : startDate;
      await db.recurringInvoice.update({ where: { id }, data: { ...data, nextRunDate } });
      await audit({ userId: user.id, action: "UPDATE", entityType: "RecurringInvoice", entityId: id, summary: `Recurring profile ${input.name} updated` });
    } else {
      const r = await db.recurringInvoice.create({ data: { ...data, nextRunDate: startDate } });
      id = r.id;
      await audit({ userId: user.id, action: "CREATE", entityType: "RecurringInvoice", entityId: r.id, summary: `Recurring profile ${input.name} created` });
    }
    revalidateBilling();
    return { ok: true, message: "Recurring profile saved", redirectTo: "/billing/recurring" };
  });
}

export async function toggleRecurring(id: string, active: boolean): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const r = await db.recurringInvoice.update({ where: { id }, data: { isActive: active } });
    await audit({ userId: user.id, action: active ? "RESUME" : "PAUSE", entityType: "RecurringInvoice", entityId: id, summary: `${r.name} ${active ? "resumed" : "paused"}` });
    revalidateBilling();
    return { ok: true, message: active ? "Profile resumed" : "Profile paused" };
  });
}

export async function deleteRecurring(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "FULL");
    const r = await db.recurringInvoice.findUniqueOrThrow({ where: { id }, include: { _count: { select: { invoices: true } } } });
    if (r._count.invoices > 0) {
      await db.recurringInvoice.update({ where: { id }, data: { isActive: false, endDate: new Date(isoDate(new Date()) + "T00:00:00.000Z") } });
    } else {
      await db.recurringInvoice.delete({ where: { id } });
    }
    await audit({ userId: user.id, action: "DELETE", entityType: "RecurringInvoice", entityId: id, summary: `Recurring profile ${r.name} ${r._count.invoices ? "ended" : "deleted"}` });
    revalidateBilling();
    return { ok: true, message: r._count.invoices ? "Profile ended (kept for history)" : "Profile deleted" };
  });
}

export async function runRecurringNow(): Promise<ActionState> {
  return run(async () => {
    await requireActionAccess("billing", "EDIT");
    const { runRecurringInvoices } = await import("@/lib/jobs");
    const res = await runRecurringInvoices();
    revalidateBilling();
    return { ok: true, message: res.length ? `${res.length} invoice(s) generated` : "No profiles are due today" };
  });
}

/** Retainer helper: create a monthly recurring profile from a project. */
export async function recurringFromProject(projectId: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("billing", "EDIT");
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { service: true } });
    if (!p.clientId) throw new ActionError("Link the project to a client first.");
    if (!p.monthlyFee) throw new ActionError("Set the project's monthly fee first.");
    const existing = await db.recurringInvoice.findFirst({ where: { projectId, isActive: true } });
    if (existing) throw new ActionError("This project already has an active recurring invoice.");
    const settings = await db.companySettings.findUnique({ where: { id: 1 } });
    const start = p.startDate && p.startDate > new Date() ? p.startDate : addMonths(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), 1);
    const r = await db.recurringInvoice.create({
      data: {
        name: `${p.name} — monthly retainer`,
        clientId: p.clientId,
        projectId,
        invoiceType: settings?.gstRegistered && settings.gstin ? "TAX_INVOICE" : "NON_GST",
        frequency: "MONTHLY",
        startDate: start,
        nextRunDate: start,
        dueInDays: settings?.defaultDueDays ?? 7,
        items: [{
          serviceId: p.serviceId ?? null, description: p.service?.name ?? p.name, details: "Monthly retainer", sacCode: p.service?.sacCode ?? null,
          unit: "Month", quantity: "1", unitPrice: p.monthlyFee.toString(), discountPercent: "0", taxRate: p.service?.defaultTaxRate.toString() ?? "0",
        }],
      },
    });
    await audit({ userId: user.id, action: "CREATE", entityType: "RecurringInvoice", entityId: r.id, summary: `Recurring invoice created from project ${p.name}` });
    revalidateBilling();
    return { ok: true, message: "Recurring invoice created", redirectTo: `/billing/recurring/${r.id}` };
  });
}
