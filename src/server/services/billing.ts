import "server-only";
import { randomBytes } from "node:crypto";
import type { InvoiceType, PaymentMethod, QuoteKind } from "@prisma/client";
import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { ActionError } from "@/lib/action";
import { audit } from "@/lib/audit";
import { computeDocument, isInterStateSupply } from "@/lib/gst";
import { D, Decimal } from "@/lib/money";
import { addDays, fmtDate, todayIST } from "@/lib/dates";
import { nextDocumentNumber } from "@/lib/numbering";
import { invoiceOutstanding, recalcInvoice } from "@/lib/finance/ledger";
import { optStr, money, percent, quantity } from "@/lib/validators";
import { getSettings } from "@/lib/settings";

// ───────────────────────── Shared line-item schema ─────────────────────────

export const itemSchema = z.object({
  serviceId: z.string().max(64).nullish().transform((v) => v || null),
  description: z.string().trim().min(1, "Item description is required").max(300),
  details: optStr(2000),
  sacCode: z
    .string()
    .trim()
    .max(8)
    .regex(/^\d{0,8}$/, "SAC/HSN must be digits")
    .nullish()
    .transform((v) => v || null),
  unit: optStr(20),
  quantity,
  unitPrice: money("Unit price"),
  discountPercent: percent("Discount"),
  taxRate: percent("Tax rate"),
});
export type ItemInput = z.infer<typeof itemSchema>;

function computeItems(items: ItemInput[], opts: { gstApplicable: boolean; interState: boolean; roundOff: boolean }) {
  const doc = computeDocument(items, opts);
  const rows = items.map((it, i) => {
    const r = doc.lines[i]!;
    return {
      serviceId: it.serviceId,
      description: it.description,
      details: it.details,
      sacCode: it.sacCode,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discountPercent: it.discountPercent,
      taxRate: r.taxRate.toFixed(2),
      lineSubtotal: r.lineSubtotal.toFixed(2),
      discountAmount: r.discountAmount.toFixed(2),
      taxableAmount: r.taxableAmount.toFixed(2),
      cgstAmount: r.cgstAmount.toFixed(2),
      sgstAmount: r.sgstAmount.toFixed(2),
      igstAmount: r.igstAmount.toFixed(2),
      taxAmount: r.taxAmount.toFixed(2),
      total: r.total.toFixed(2),
      sortOrder: i,
    };
  });
  return { doc, rows };
}

// ───────────────────────── Invoices ─────────────────────────

export const invoiceSchema = z.object({
  type: z.enum(["TAX_INVOICE", "NON_GST", "PROFORMA", "ADVANCE", "CREDIT_NOTE", "DEBIT_NOTE"]),
  clientId: z.string().min(1, "Select a client"),
  projectId: z.string().nullish().transform((v) => v || null),
  relatedInvoiceId: z.string().nullish().transform((v) => v || null),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invoice date is required"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  placeOfSupply: z.string().regex(/^\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  periodLabel: optStr(60),
  reverseCharge: z.boolean().default(false),
  paymentTerms: optStr(1000),
  notes: optStr(2000),
  terms: optStr(5000),
  reason: optStr(500),
  items: z.array(itemSchema).min(1, "Add at least one line item").max(100),
});
export type InvoiceInput = z.infer<typeof invoiceSchema>;

const GST_TYPES: InvoiceType[] = ["TAX_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE", "PROFORMA", "ADVANCE"];

async function prepareInvoice(tx: Tx, input: InvoiceInput) {
  const settings = await getSettings();
  const client = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
  if (!client) throw new ActionError("Client not found.", { clientId: "Client not found" });
  if (input.type === "TAX_INVOICE" && (!settings.gstRegistered || !settings.gstin)) {
    throw new ActionError(
      "GST tax invoices need a GST registration. Add your GSTIN in Settings → Company & GST, or issue a Non-GST invoice.",
      { type: "Company is not GST-registered" },
    );
  }
  if ((input.type === "CREDIT_NOTE" || input.type === "DEBIT_NOTE") && !input.relatedInvoiceId) {
    throw new ActionError("Select the original invoice for this note.", { relatedInvoiceId: "Original invoice is required" });
  }
  if (input.relatedInvoiceId) {
    const related = await tx.invoice.findUnique({ where: { id: input.relatedInvoiceId } });
    if (!related || related.clientId !== input.clientId || !["ISSUED", "PARTIALLY_PAID", "PAID"].includes(related.status)) {
      throw new ActionError("The original invoice must be an issued invoice of the same client.", { relatedInvoiceId: "Invalid invoice" });
    }
    if (!["TAX_INVOICE", "NON_GST"].includes(related.type)) {
      throw new ActionError("Notes can only be raised against GST or Non-GST invoices.", { relatedInvoiceId: "Invalid invoice type" });
    }
  }
  if (input.projectId) {
    const project = await tx.project.findFirst({ where: { id: input.projectId, deletedAt: null } });
    if (!project) throw new ActionError("Project not found.", { projectId: "Project not found" });
  }
  const issueDate = new Date(`${input.issueDate}T00:00:00.000Z`);
  const dueDate = input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null;
  if (dueDate && dueDate < issueDate) throw new ActionError("Due date cannot be before the invoice date.", { dueDate: "Must be on/after invoice date" });
  const gstApplicable = settings.gstRegistered && GST_TYPES.includes(input.type);
  const placeOfSupply = input.placeOfSupply ?? client.stateCode ?? settings.stateCode ?? null;
  const interState = isInterStateSupply({ supplierStateCode: settings.stateCode, placeOfSupply, clientCountry: client.country });
  const { doc, rows } = computeItems(input.items, { gstApplicable, interState, roundOff: settings.roundOffTotals });
  if (doc.total.lte(0)) throw new ActionError("Invoice total must be greater than zero.");
  if (input.type === "CREDIT_NOTE" && input.relatedInvoiceId) {
    const related = await tx.invoice.findUniqueOrThrow({ where: { id: input.relatedInvoiceId } });
    const available = D(related.total).minus(D(related.amountCredited));
    if (doc.total.gt(available)) {
      throw new ActionError(`Credit note total cannot exceed ₹${available.toFixed(2)} (invoice value not yet credited).`);
    }
  }
  return {
    client,
    settings,
    data: {
      type: input.type,
      clientId: input.clientId,
      projectId: input.projectId,
      relatedInvoiceId: input.relatedInvoiceId,
      issueDate,
      dueDate,
      periodLabel: input.periodLabel,
      placeOfSupply,
      gstApplicable,
      isInterState: interState,
      reverseCharge: input.reverseCharge,
      clientName: client.businessName || client.name,
      clientGstin: client.gstin,
      clientAddress: [client.billingAddress, client.city, client.state, client.pincode, client.country !== "India" ? client.country : null].filter(Boolean).join(", "),
      clientStateCode: client.stateCode,
      subtotal: doc.subtotal.toFixed(2),
      discountTotal: doc.discountTotal.toFixed(2),
      taxableAmount: doc.taxableAmount.toFixed(2),
      cgstAmount: doc.cgstAmount.toFixed(2),
      sgstAmount: doc.sgstAmount.toFixed(2),
      igstAmount: doc.igstAmount.toFixed(2),
      taxTotal: doc.taxTotal.toFixed(2),
      roundOff: doc.roundOff.toFixed(2),
      total: doc.total.toFixed(2),
      paymentTerms: input.paymentTerms,
      notes: input.notes,
      terms: input.terms,
      reason: input.reason,
    },
    rows,
  };
}

export async function createInvoice(tx: Tx, input: InvoiceInput, userId: string | null, extra: { recurringProfileId?: string } = {}) {
  const { data, rows } = await prepareInvoice(tx, input);
  const invoice = await tx.invoice.create({
    data: { ...data, status: "DRAFT", createdById: userId, recurringProfileId: extra.recurringProfileId ?? null, items: { create: rows } },
  });
  await audit({ userId, action: "CREATE", entityType: "Invoice", entityId: invoice.id, summary: `Draft ${input.type.replace(/_/g, " ").toLowerCase()} created for ${data.clientName} (₹${data.total})` }, tx);
  return invoice;
}

export async function updateDraftInvoice(tx: Tx, id: string, input: InvoiceInput, userId: string) {
  const existing = await tx.invoice.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new ActionError("Invoice not found.");
  if (existing.status !== "DRAFT") throw new ActionError("Only draft invoices can be edited. Issue a credit or debit note to adjust an issued invoice.");
  const { data, rows } = await prepareInvoice(tx, input);
  await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
  const invoice = await tx.invoice.update({ where: { id }, data: { ...data, items: { create: rows } } });
  await audit({ userId, action: "UPDATE", entityType: "Invoice", entityId: id, summary: `Draft invoice updated (₹${data.total})` }, tx);
  return invoice;
}

export async function issueInvoice(tx: Tx, id: string, userId: string | null) {
  const inv = await tx.invoice.findUnique({ where: { id }, include: { client: true } });
  if (!inv || inv.deletedAt) throw new ActionError("Invoice not found.");
  if (inv.status !== "DRAFT") throw new ActionError("This invoice has already been issued.");
  const settings = await getSettings();
  if (inv.type === "TAX_INVOICE" && (!settings.gstRegistered || !settings.gstin)) {
    throw new ActionError("Add your GSTIN in Settings before issuing a GST tax invoice.");
  }
  const number = await nextDocumentNumber(tx, inv.type, inv.issueDate, settings.fyStartMonth);
  const updated = await tx.invoice.update({
    where: { id },
    data: {
      number,
      status: "ISSUED",
      issuedAt: new Date(),
      clientName: inv.client.businessName || inv.client.name,
      clientGstin: inv.client.gstin,
      clientStateCode: inv.client.stateCode,
    },
  });
  if (inv.relatedInvoiceId) await recalcInvoice(tx, inv.relatedInvoiceId);
  await recalcInvoice(tx, id);
  await audit({ userId, action: "ISSUE", entityType: "Invoice", entityId: id, summary: `Issued ${number} to ${updated.clientName} for ₹${updated.total.toFixed(2)}` }, tx);
  return updated;
}

export async function cancelInvoice(tx: Tx, id: string, reason: string, userId: string) {
  const inv = await tx.invoice.findUnique({ where: { id }, include: { payments: { where: { voidedAt: null } }, adjustments: { where: { status: { not: "CANCELLED" } } } } });
  if (!inv) throw new ActionError("Invoice not found.");
  if (inv.status === "CANCELLED") throw new ActionError("Invoice is already cancelled.");
  if (inv.status === "DRAFT") throw new ActionError("Drafts can be deleted instead of cancelled.");
  if (inv.payments.length) throw new ActionError("Void the payments recorded against this invoice before cancelling it.");
  if (inv.adjustments.length) throw new ActionError("Cancel the credit/debit notes linked to this invoice first.");
  await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
  if (inv.relatedInvoiceId) await recalcInvoice(tx, inv.relatedInvoiceId);
  await audit({ userId, action: "CANCEL", entityType: "Invoice", entityId: id, summary: `Cancelled ${inv.number}: ${reason}` }, tx);
}

// ───────────────────────── Payments ─────────────────────────

export const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date is required"),
  amount: money("Amount received"),
  tdsAmount: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("TDS")),
  method: z.enum(["BANK_TRANSFER", "UPI", "CASH", "CHEQUE", "CARD", "PAYMENT_GATEWAY", "OTHER"]),
  accountId: z.string().min(1, "Select the account the money was received in"),
  reference: optStr(120),
  notes: optStr(1000),
});

export async function systemCategory(tx: Tx, name: string, type: "INCOME" | "EXPENSE", kind: "REVENUE" | "OPERATING_EXPENSE" | "COST_OF_SERVICES") {
  return (
    (await tx.category.findFirst({ where: { name, type } })) ??
    (await tx.category.create({ data: { name, type, kind, isSystem: true } }))
  );
}

export async function recordPayment(tx: Tx, raw: z.input<typeof paymentSchema>, userId: string) {
  const input = paymentSchema.parse(raw);
  const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId } });
  if (!inv || inv.deletedAt) throw new ActionError("Invoice not found.");
  if (inv.type === "CREDIT_NOTE") throw new ActionError("Payments cannot be recorded against a credit note.");
  if (!["ISSUED", "PARTIALLY_PAID"].includes(inv.status)) throw new ActionError("Payments can only be recorded against issued, unpaid invoices.");
  const account = await tx.account.findUnique({ where: { id: input.accountId } });
  if (!account || !account.isActive) throw new ActionError("Select an active account.", { accountId: "Invalid account" });
  const paymentDate = new Date(`${input.paymentDate}T00:00:00.000Z`);
  if (paymentDate < inv.issueDate) throw new ActionError("Payment date cannot be before the invoice date.", { paymentDate: "Before invoice date" });
  if (paymentDate < account.openingDate) throw new ActionError(`Payment date is before the opening date of ${account.name}.`, { paymentDate: "Before account opening date" });
  const settle = D(input.amount).plus(D(input.tdsAmount));
  const outstanding = invoiceOutstanding(inv);
  if (settle.lte(0)) throw new ActionError("Amount must be greater than zero.", { amount: "Must be greater than zero" });
  if (settle.gt(outstanding.plus(0.009))) {
    throw new ActionError(`Amount + TDS (₹${settle.toFixed(2)}) exceeds the outstanding balance of ₹${outstanding.toFixed(2)}.`, { amount: "Exceeds outstanding" });
  }
  const settings = await getSettings();
  const receiptNumber = await nextDocumentNumber(tx, "RECEIPT", paymentDate, settings.fyStartMonth);
  const payment = await tx.payment.create({
    data: {
      receiptNumber,
      invoiceId: inv.id,
      clientId: inv.clientId,
      paymentDate,
      amount: input.amount,
      tdsAmount: input.tdsAmount,
      method: input.method as PaymentMethod,
      reference: input.reference,
      accountId: input.accountId,
      notes: input.notes,
    },
  });
  if (D(input.amount).gt(0)) {
    const category = await systemCategory(tx, "Client Payments", "INCOME", "REVENUE");
    await tx.transaction.create({
      data: {
        type: "INCOME",
        date: paymentDate,
        amount: input.amount,
        description: `Payment received — ${inv.number ?? "invoice"} (${receiptNumber})`,
        reference: input.reference,
        method: input.method as PaymentMethod,
        accountId: input.accountId,
        categoryId: category.id,
        clientId: inv.clientId,
        projectId: inv.projectId,
        paymentId: payment.id,
        createdById: userId,
      },
    });
  }
  await recalcInvoice(tx, inv.id);
  await audit({ userId, action: "PAYMENT", entityType: "Invoice", entityId: inv.id, summary: `Payment ${receiptNumber} of ₹${D(input.amount).toFixed(2)}${D(input.tdsAmount).gt(0) ? ` + TDS ₹${D(input.tdsAmount).toFixed(2)}` : ""} recorded against ${inv.number}` }, tx);
  return payment;
}

export async function voidPayment(tx: Tx, paymentId: string, reason: string, userId: string) {
  const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!p) throw new ActionError("Payment not found.");
  if (p.voidedAt) throw new ActionError("Payment is already voided.");
  await tx.payment.update({ where: { id: paymentId }, data: { voidedAt: new Date(), voidReason: reason } });
  await tx.transaction.updateMany({ where: { paymentId }, data: { deletedAt: new Date() } });
  await recalcInvoice(tx, p.invoiceId);
  await audit({ userId, action: "VOID", entityType: "Payment", entityId: paymentId, summary: `Voided receipt ${p.receiptNumber} (₹${p.amount.toFixed(2)}) on ${p.invoice.number}: ${reason}` }, tx);
}

// ───────────────────────── Quotes / proposals / estimates ─────────────────────────

export const quoteSchema = z.object({
  kind: z.enum(["PROPOSAL", "QUOTATION", "ESTIMATE"]),
  title: z.string().trim().min(2, "Title is required").max(200),
  clientId: z.string().min(1, "Select a client"),
  projectId: z.string().nullish().transform((v) => v || null),
  templateId: z.string().nullish().transform((v) => v || null),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  placeOfSupply: z.string().regex(/^\d{2}$/).nullish().or(z.literal("")).transform((v) => v || null),
  gstApplicable: z.boolean().default(true),
  introduction: optStr(5000),
  scopeOfWork: optStr(10000),
  deliverables: optStr(10000),
  timeline: optStr(5000),
  paymentTerms: optStr(3000),
  terms: optStr(10000),
  notes: optStr(3000),
  items: z.array(itemSchema).min(1, "Add at least one service").max(100),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

async function prepareQuote(tx: Tx, input: QuoteInput) {
  const settings = await getSettings();
  const client = await tx.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
  if (!client) throw new ActionError("Client not found.", { clientId: "Client not found" });
  const issueDate = new Date(`${input.issueDate}T00:00:00.000Z`);
  const expiryDate = input.expiryDate ? new Date(`${input.expiryDate}T00:00:00.000Z`) : addDays(issueDate, settings.quoteValidityDays);
  if (expiryDate < issueDate) throw new ActionError("Expiry date cannot be before the document date.", { expiryDate: "Before document date" });
  const gstApplicable = input.gstApplicable && settings.gstRegistered;
  const placeOfSupply = input.placeOfSupply ?? client.stateCode ?? settings.stateCode ?? null;
  const interState = isInterStateSupply({ supplierStateCode: settings.stateCode, placeOfSupply, clientCountry: client.country });
  const { doc, rows } = computeItems(input.items, { gstApplicable, interState, roundOff: settings.roundOffTotals });
  return {
    settings,
    data: {
      kind: input.kind as QuoteKind,
      title: input.title,
      clientId: input.clientId,
      projectId: input.projectId,
      templateId: input.templateId,
      issueDate,
      expiryDate,
      introduction: input.introduction,
      scopeOfWork: input.scopeOfWork,
      deliverables: input.deliverables,
      timeline: input.timeline,
      paymentTerms: input.paymentTerms,
      terms: input.terms,
      notes: input.notes,
      gstApplicable,
      isInterState: interState,
      placeOfSupply,
      subtotal: doc.subtotal.toFixed(2),
      discountTotal: doc.discountTotal.toFixed(2),
      taxableAmount: doc.taxableAmount.toFixed(2),
      taxTotal: doc.taxTotal.toFixed(2),
      roundOff: doc.roundOff.toFixed(2),
      total: doc.total.toFixed(2),
    },
    rows: rows.map(({ cgstAmount: _c, sgstAmount: _s, igstAmount: _i, ...r }) => r),
  };
}

export async function createQuote(tx: Tx, input: QuoteInput, userId: string) {
  const { settings, data, rows } = await prepareQuote(tx, input);
  const number = await nextDocumentNumber(tx, input.kind, data.issueDate, settings.fyStartMonth);
  const quote = await tx.quote.create({ data: { ...data, number, createdById: userId, items: { create: rows } } });
  await audit({ userId, action: "CREATE", entityType: "Quote", entityId: quote.id, summary: `${input.kind.toLowerCase()} ${number} created (₹${data.total})` }, tx);
  return quote;
}

export async function updateQuote(tx: Tx, id: string, input: QuoteInput, userId: string) {
  const existing = await tx.quote.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new ActionError("Document not found.");
  if (existing.status !== "DRAFT") {
    throw new ActionError("Only drafts can be edited directly. Use “New version” to revise a sent document.");
  }
  if (existing.kind !== input.kind) throw new ActionError("Document type cannot be changed after creation.");
  const { data, rows } = await prepareQuote(tx, input);
  await tx.quoteItem.deleteMany({ where: { quoteId: id } });
  const quote = await tx.quote.update({ where: { id }, data: { ...data, items: { create: rows } } });
  await audit({ userId, action: "UPDATE", entityType: "Quote", entityId: id, summary: `${existing.number} updated (₹${data.total})` }, tx);
  return quote;
}

/** Copy a quote. `asVersion` creates the next version in the same chain; otherwise a new independent document. */
export async function duplicateQuote(tx: Tx, id: string, userId: string, asVersion: boolean) {
  const q = await tx.quote.findUnique({ where: { id }, include: { items: true, nextVersion: true } });
  if (!q) throw new ActionError("Document not found.");
  if (asVersion && q.nextVersion) throw new ActionError("A newer version already exists — revise the latest version.");
  const settings = await getSettings();
  const today = todayIST();
  let number: string;
  if (asVersion) {
    const base = q.number.replace(/-v\d+$/, "");
    number = `${base}-v${q.version + 1}`;
  } else {
    number = await nextDocumentNumber(tx, q.kind, today, settings.fyStartMonth);
  }
  const { id: _id, number: _n, createdAt: _c, updatedAt: _u, items, nextVersion: _nv, shareToken: _st, convertedInvoiceId: _ci, sentAt: _sa, acceptedAt: _aa, rejectedAt: _ra, deletedAt: _d, ...rest } = q;
  const copy = await tx.quote.create({
    data: {
      ...rest,
      number,
      status: "DRAFT",
      version: asVersion ? q.version + 1 : 1,
      rootId: asVersion ? (q.rootId ?? q.id) : null,
      previousVersionId: asVersion ? q.id : null,
      issueDate: today,
      expiryDate: addDays(today, settings.quoteValidityDays),
      createdById: userId,
      items: { create: items.map(({ id: _i, quoteId: _q, ...it }) => it) },
    },
  });
  await audit({ userId, action: asVersion ? "VERSION" : "DUPLICATE", entityType: "Quote", entityId: copy.id, summary: `${number} created from ${q.number}` }, tx);
  return copy;
}

export async function setQuoteStatus(tx: Tx, id: string, status: "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "DRAFT", userId: string) {
  const q = await tx.quote.findUnique({ where: { id } });
  if (!q) throw new ActionError("Document not found.");
  if (q.convertedInvoiceId) throw new ActionError("This document has been converted to an invoice and is locked.");
  const allowed: Record<string, string[]> = {
    DRAFT: ["SENT", "ACCEPTED", "REJECTED"],
    SENT: ["ACCEPTED", "REJECTED", "EXPIRED", "DRAFT"],
    ACCEPTED: ["SENT"],
    REJECTED: ["SENT"],
    EXPIRED: ["SENT"],
  };
  if (!allowed[q.status]?.includes(status)) throw new ActionError(`Cannot change status from ${q.status} to ${status}.`);
  const now = new Date();
  await tx.quote.update({
    where: { id },
    data: {
      status,
      sentAt: status === "SENT" ? (q.sentAt ?? now) : q.sentAt,
      acceptedAt: status === "ACCEPTED" ? now : null,
      rejectedAt: status === "REJECTED" ? now : null,
    },
  });
  await audit({ userId, action: "STATUS", entityType: "Quote", entityId: id, summary: `${q.number}: ${q.status} → ${status}` }, tx);
}

export function newShareToken() {
  return randomBytes(24).toString("base64url");
}

export async function convertQuoteToInvoice(tx: Tx, id: string, userId: string) {
  const q = await tx.quote.findUnique({ where: { id }, include: { items: true } });
  if (!q) throw new ActionError("Document not found.");
  if (q.status !== "ACCEPTED") throw new ActionError("Only accepted documents can be converted into an invoice.");
  if (q.convertedInvoiceId) throw new ActionError("This document was already converted to an invoice.");
  const settings = await getSettings();
  const type: InvoiceType = settings.gstRegistered && settings.gstin ? "TAX_INVOICE" : "NON_GST";
  const today = todayIST();
  const invoice = await createInvoice(
    tx,
    {
      type,
      clientId: q.clientId,
      projectId: q.projectId,
      relatedInvoiceId: null,
      issueDate: today.toISOString().slice(0, 10),
      dueDate: addDays(today, settings.defaultDueDays).toISOString().slice(0, 10),
      placeOfSupply: q.placeOfSupply,
      periodLabel: null,
      reverseCharge: false,
      paymentTerms: q.paymentTerms,
      notes: `As per ${q.kind.toLowerCase()} ${q.number} dated ${fmtDate(q.issueDate)}.`,
      terms: settings.defaultInvoiceTerms,
      reason: null,
      items: q.items.map((it) => ({
        serviceId: it.serviceId,
        description: it.description,
        details: it.details,
        sacCode: it.sacCode,
        unit: it.unit,
        quantity: it.quantity.toString(),
        unitPrice: it.unitPrice.toString(),
        discountPercent: it.discountPercent.toString(),
        taxRate: it.taxRate.toString(),
      })),
    },
    userId,
  );
  await tx.quote.update({ where: { id }, data: { convertedInvoiceId: invoice.id } });
  await audit({ userId, action: "CONVERT", entityType: "Quote", entityId: id, summary: `${q.number} converted to draft invoice` }, tx);
  return invoice;
}

/** Proforma / advance → final invoice. Payments move to the new invoice so they are not counted twice. */
export async function convertAdvanceToInvoice(tx: Tx, id: string, userId: string) {
  const inv = await tx.invoice.findUnique({ where: { id }, include: { items: true, payments: { where: { voidedAt: null } } } });
  if (!inv) throw new ActionError("Invoice not found.");
  if (!["PROFORMA", "ADVANCE"].includes(inv.type)) throw new ActionError("Only proforma or advance invoices can be converted.");
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") throw new ActionError("Issue the proforma first.");
  const settings = await getSettings();
  const type: InvoiceType = settings.gstRegistered && settings.gstin ? "TAX_INVOICE" : "NON_GST";
  const today = todayIST();
  const created = await createInvoice(
    tx,
    {
      type,
      clientId: inv.clientId,
      projectId: inv.projectId,
      relatedInvoiceId: null,
      issueDate: today.toISOString().slice(0, 10),
      dueDate: (inv.dueDate && inv.dueDate > today ? inv.dueDate : addDays(today, settings.defaultDueDays)).toISOString().slice(0, 10),
      placeOfSupply: inv.placeOfSupply,
      periodLabel: inv.periodLabel,
      reverseCharge: inv.reverseCharge,
      paymentTerms: inv.paymentTerms,
      notes: `Against ${inv.type === "PROFORMA" ? "proforma" : "advance"} invoice ${inv.number}.`,
      terms: inv.terms,
      reason: null,
      items: inv.items.map((it) => ({
        serviceId: it.serviceId,
        description: it.description,
        details: it.details,
        sacCode: it.sacCode,
        unit: it.unit,
        quantity: it.quantity.toString(),
        unitPrice: it.unitPrice.toString(),
        discountPercent: it.discountPercent.toString(),
        taxRate: it.taxRate.toString(),
      })),
    },
    userId,
  );
  const issued = await issueInvoice(tx, created.id, userId);
  const paid = inv.payments.reduce((a, p) => a.plus(D(p.amount)).plus(D(p.tdsAmount)), new Decimal(0));
  if (paid.gt(D(issued.total))) throw new ActionError("Payments received exceed the new invoice total — adjust the proforma first.");
  await tx.payment.updateMany({ where: { invoiceId: inv.id, voidedAt: null }, data: { invoiceId: issued.id } });
  await tx.transaction.updateMany({ where: { paymentId: { in: inv.payments.map((p) => p.id) } }, data: { description: `Payment received — ${issued.number}` } });
  await tx.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Converted to ${issued.number}` } });
  await recalcInvoice(tx, issued.id);
  await audit({ userId, action: "CONVERT", entityType: "Invoice", entityId: inv.id, summary: `${inv.number} converted to ${issued.number}; ${inv.payments.length} payment(s) moved` }, tx);
  return issued;
}

export { db };
