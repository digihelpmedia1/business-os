"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { emitEvent } from "@/lib/integrations";
import { D } from "@/lib/money";
import { normalizeName } from "@/lib/utils";
import { checkbox, dateStr, email, gstin, money, optDate, optId, optInt, optStr, pan, phone, reqStr, stateCode } from "@/lib/validators";
import { recalcVendorBill } from "@/lib/finance/ledger";
import { storeUpload } from "@/lib/storage";

function revalidateVendors() {
  revalidatePath("/vendors", "layout");
  revalidatePath("/finance", "layout");
  revalidatePath("/dashboard");
}

const vendorSchema = z.object({
  name: reqStr("Vendor name", 150),
  category: optStr(80),
  contactPerson: optStr(120),
  email,
  phone,
  gstin,
  pan,
  address: optStr(500),
  stateCode,
  website: optStr(200),
  paymentTermsDays: optInt(0, 365),
  bankDetails: optStr(500),
  notes: optStr(2000),
  isActive: checkbox,
});

export async function saveVendor(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vendors", "EDIT");
    const input = vendorSchema.parse(formToObject(fd));
    const normalizedName = normalizeName(input.name);
    // Duplicate prevention: same normalised name or same GSTIN.
    const dup = await db.vendor.findFirst({
      where: { deletedAt: null, OR: [{ normalizedName }, ...(input.gstin ? [{ gstin: input.gstin }] : [])], ...(id ? { NOT: { id } } : {}) },
    });
    if (dup) throw new ActionError(`Vendor “${dup.name}” already exists${dup.gstin && dup.gstin === input.gstin ? " with this GSTIN" : ""}. Edit that record instead of creating a duplicate.`, { name: "Duplicate vendor" });
    const data = { ...input, normalizedName };
    let vendorId = id;
    if (id) {
      const before = await db.vendor.findUniqueOrThrow({ where: { id } });
      await db.vendor.update({ where: { id }, data });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Vendor", entityId: id, summary: `Vendor ${input.name} updated`, changes: diff(before, data) });
    } else {
      const v = await db.vendor.create({ data });
      vendorId = v.id;
      await audit({ userId: user.id, action: "CREATE", entityType: "Vendor", entityId: v.id, summary: `Vendor ${input.name} created` });
    }
    revalidateVendors();
    return { ok: true, message: "Vendor saved", redirectTo: id ? undefined : `/vendors/${vendorId}` };
  });
}

export async function archiveVendor(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vendors", "FULL");
    const open = await db.vendorBill.count({ where: { vendorId: id, deletedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] } } });
    if (open) throw new ActionError(`This vendor has ${open} unpaid bill(s).`);
    const v = await db.vendor.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await audit({ userId: user.id, action: "ARCHIVE", entityType: "Vendor", entityId: id, summary: `Vendor ${v.name} archived` });
    revalidateVendors();
    return { ok: true, message: "Vendor archived", redirectTo: "/vendors" };
  });
}

const billSchema = z.object({
  vendorId: z.string().min(1, "Select a vendor"),
  billNumber: reqStr("Bill number", 60),
  billDate: dateStr("Bill date"),
  dueDate: optDate(),
  categoryId: z.string().min(1, "Select a category"),
  projectId: optId,
  description: optStr(500),
  subtotal: money("Amount before GST", { allowZero: false }),
  taxAmount: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("Input GST")),
  notes: optStr(1000),
});

export async function saveBill(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vendors", "EDIT");
    const raw = formToObject(fd);
    const file = raw.attachment instanceof File && raw.attachment.size > 0 ? raw.attachment : null;
    delete raw.attachment;
    const input = billSchema.parse(raw);
    if (input.dueDate && input.dueDate < input.billDate) throw new ActionError("Due date is before bill date.", { dueDate: "Before bill date" });
    const cat = await db.category.findUnique({ where: { id: input.categoryId } });
    if (!cat || cat.type !== "EXPENSE") throw new ActionError("Choose an expense category.", { categoryId: "Expense category required" });
    const total = D(input.subtotal).plus(D(input.taxAmount)).toFixed(2);
    const billId = await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.vendorBill.findUniqueOrThrow({ where: { id } });
        if (before.status === "CANCELLED") throw new ActionError("Cancelled bills cannot be edited.");
        if (D(total).lt(D(before.amountPaid))) throw new ActionError(`Total can't be less than the ₹${before.amountPaid.toFixed(2)} already paid.`);
        await tx.vendorBill.update({ where: { id }, data: { ...input, total } });
        await recalcVendorBill(tx, id);
        await audit({ userId: user.id, action: "UPDATE", entityType: "VendorBill", entityId: id, summary: `Bill ${input.billNumber} updated`, changes: diff(before, { ...input, total }) }, tx);
        return id;
      }
      const b = await tx.vendorBill.create({ data: { ...input, total } });
      await audit({ userId: user.id, action: "CREATE", entityType: "VendorBill", entityId: b.id, summary: `Bill ${input.billNumber} recorded (₹${total})` }, tx);
      emitEvent("bill.created", b);
      return b.id;
    });
    if (file) {
      const stored = await storeUpload(file, user.id);
      await db.document.create({ data: { title: `Bill ${input.billNumber}`, category: "PURCHASE_BILL", fileId: stored.id, vendorId: input.vendorId, vendorBillId: billId, projectId: input.projectId, uploadedById: user.id } });
    }
    revalidateVendors();
    return { ok: true, message: "Bill saved" };
  });
}

const billPaymentSchema = z.object({
  date: dateStr("Payment date"),
  amount: money("Amount", { allowZero: false }),
  accountId: z.string().min(1, "Select an account"),
  method: z.enum(["BANK_TRANSFER", "UPI", "CASH", "CHEQUE", "CARD", "PAYMENT_GATEWAY", "OTHER"]),
  reference: optStr(120),
});

export async function payBill(billId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vendors", "EDIT");
    const input = billPaymentSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findUniqueOrThrow({ where: { id: billId }, include: { vendor: true } });
      if (bill.status === "CANCELLED") throw new ActionError("This bill is cancelled.");
      const outstanding = D(bill.total).minus(D(bill.amountPaid));
      if (D(input.amount).gt(outstanding.plus(0.009))) throw new ActionError(`Amount exceeds the outstanding ₹${outstanding.toFixed(2)}.`, { amount: "Exceeds outstanding" });
      const account = await tx.account.findUniqueOrThrow({ where: { id: input.accountId } });
      if (input.date < account.openingDate) throw new ActionError(`Date is before the opening date of ${account.name}.`, { date: "Before account opening" });
      await tx.transaction.create({
        data: {
          type: "EXPENSE", date: input.date, amount: input.amount, description: `Payment to ${bill.vendor.name} — bill ${bill.billNumber}`, reference: input.reference,
          method: input.method, accountId: input.accountId, categoryId: bill.categoryId, vendorId: bill.vendorId, vendorBillId: bill.id, projectId: bill.projectId, createdById: user.id,
        },
      });
      const updated = await recalcVendorBill(tx, bill.id);
      if (updated.status === "PAID") emitEvent("bill.paid", updated);
      await audit({ userId: user.id, action: "PAYMENT", entityType: "VendorBill", entityId: bill.id, summary: `Paid ₹${input.amount} to ${bill.vendor.name} for bill ${bill.billNumber}` }, tx);
    });
    revalidateVendors();
    return { ok: true, message: "Payment recorded" };
  });
}

export async function cancelBill(id: string, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("vendors", "FULL");
    const reason = z.string().trim().min(3, "Give a reason").parse(fd.get("reason"));
    const bill = await db.vendorBill.findUniqueOrThrow({ where: { id } });
    if (D(bill.amountPaid).gt(0)) throw new ActionError("Delete the payments linked to this bill (Finance → Transactions) before cancelling it.");
    await db.vendorBill.update({ where: { id }, data: { status: "CANCELLED", notes: [bill.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
    await audit({ userId: user.id, action: "CANCEL", entityType: "VendorBill", entityId: id, summary: `Bill ${bill.billNumber} cancelled: ${reason}` });
    revalidateVendors();
    return { ok: true, message: "Bill cancelled" };
  });
}
