"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { emitEvent } from "@/lib/integrations";
import { D } from "@/lib/money";
import { checkbox, dateStr, money, optId, optStr, reqStr } from "@/lib/validators";
import { recalcVendorBill } from "@/lib/finance/ledger";
import { storeUpload } from "@/lib/storage";
import { INCOME_KINDS, EXPENSE_KINDS } from "@/lib/finance/constants";

function revalidateFinance() {
  revalidatePath("/finance", "layout");
  revalidatePath("/dashboard");
}

// ───────── Accounts ─────────

const accountSchema = z.object({
  name: reqStr("Account name", 100),
  type: z.enum(["BANK", "CASH", "WALLET", "CREDIT_CARD", "OTHER"]),
  bankName: optStr(100),
  accountLast4: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}$/, "Enter the last 4 digits").optional()).transform((v) => v ?? null),
  openingBalance: money("Opening balance", { allowNegative: true }),
  openingDate: dateStr("Opening date"),
  isActive: checkbox,
  notes: optStr(1000),
});

export async function saveAccount(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("finance", "EDIT");
    const input = accountSchema.parse(formToObject(fd));
    if (id) {
      const before = await db.account.findUniqueOrThrow({ where: { id } });
      const early = await db.transaction.findFirst({ where: { OR: [{ accountId: id }, { toAccountId: id }], deletedAt: null, date: { lt: input.openingDate } } });
      if (early) throw new ActionError("Some transactions are dated before this opening date.", { openingDate: "Transactions exist before this date" });
      await db.account.update({ where: { id }, data: input });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Account", entityId: id, summary: `Account ${input.name} updated`, changes: diff(before, input) });
    } else {
      const a = await db.account.create({ data: input });
      await audit({ userId: user.id, action: "CREATE", entityType: "Account", entityId: a.id, summary: `Account ${input.name} created (opening ₹${input.openingBalance})` });
    }
    revalidateFinance();
    return { ok: true, message: "Account saved" };
  });
}

export async function deleteAccount(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("finance", "FULL");
    const used = await db.transaction.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } });
    const payments = await db.payment.count({ where: { accountId: id } });
    if (used || payments) {
      await db.account.update({ where: { id }, data: { isActive: false } });
      await audit({ userId: user.id, action: "DEACTIVATE", entityType: "Account", entityId: id, summary: "Account deactivated (has transactions)" });
      revalidateFinance();
      return { ok: true, message: "Account has transactions — it was deactivated instead of deleted." };
    }
    const a = await db.account.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Account", entityId: id, summary: `Account ${a.name} deleted` });
    revalidateFinance();
    return { ok: true, message: "Account deleted" };
  });
}

// ───────── Categories ─────────

const categorySchema = z.object({
  name: reqStr("Name", 80),
  type: z.enum(["INCOME", "EXPENSE"]),
  kind: z.enum(["REVENUE", "OTHER_INCOME", "COST_OF_SERVICES", "OPERATING_EXPENSE", "NON_OPERATING", "CAPITAL_EXPENDITURE", "TAX_SETTLEMENT", "OWNER_EQUITY"]),
  isAcquisition: checkbox,
  isActive: checkbox,
  description: optStr(300),
});

export async function saveCategory(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("finance", "EDIT");
    const input = categorySchema.parse(formToObject(fd));
    const allowed = input.type === "INCOME" ? INCOME_KINDS : EXPENSE_KINDS;
    if (!allowed.includes(input.kind)) throw new ActionError("This treatment is not valid for the selected type.", { kind: "Not valid for this type" });
    if (id) {
      const existing = await db.category.findUniqueOrThrow({ where: { id } });
      if (existing.isSystem && (existing.type !== input.type || existing.kind !== input.kind)) throw new ActionError("System categories keep their type and treatment.");
      await db.category.update({ where: { id }, data: input });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Category", entityId: id, summary: `Category ${input.name} updated`, changes: diff(existing, input) });
    } else {
      const c = await db.category.create({ data: input });
      await audit({ userId: user.id, action: "CREATE", entityType: "Category", entityId: c.id, summary: `Category ${input.name} created` });
    }
    revalidateFinance();
    return { ok: true, message: "Category saved" };
  });
}

export async function deleteCategory(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("finance", "FULL");
    const c = await db.category.findUniqueOrThrow({ where: { id }, include: { _count: { select: { transactions: true, vendorBills: true, budgets: true, subscriptions: true } } } });
    if (c.isSystem) throw new ActionError("System categories cannot be deleted.");
    const uses = c._count.transactions + c._count.vendorBills + c._count.budgets + c._count.subscriptions;
    if (uses) {
      await db.category.update({ where: { id }, data: { isActive: false } });
      revalidateFinance();
      return { ok: true, message: "Category is in use — it was deactivated instead." };
    }
    await db.category.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Category", entityId: id, summary: `Category ${c.name} deleted` });
    revalidateFinance();
    return { ok: true, message: "Category deleted" };
  });
}

// ───────── Transactions ─────────

const txnSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER"]),
  date: dateStr("Date"),
  amount: money("Amount", { allowZero: false }),
  taxAmount: z.preprocess((v) => (v === "" || v == null ? "0" : v), money("Input GST")),
  description: reqStr("Description", 300),
  reference: optStr(120),
  method: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["BANK_TRANSFER", "UPI", "CASH", "CHEQUE", "CARD", "PAYMENT_GATEWAY", "OTHER"]).optional()).transform((v) => v ?? null),
  accountId: z.string().min(1, "Select an account"),
  toAccountId: optId,
  categoryId: optId,
  clientId: optId,
  projectId: optId,
  serviceId: optId,
  vendorId: optId,
  vendorBillId: optId,
  employeeId: optId,
  payrollMonth: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM").optional()).transform((v) => v ?? null),
  subscriptionId: optId,
});

export type TxnInput = z.infer<typeof txnSchema>;

async function validateTxn(input: TxnInput) {
  const account = await db.account.findUnique({ where: { id: input.accountId } });
  if (!account) throw new ActionError("Account not found.", { accountId: "Not found" });
  if (input.date < account.openingDate) throw new ActionError(`Date is before the opening date of ${account.name}.`, { date: "Before account opening date" });
  if (input.type === "TRANSFER") {
    if (!input.toAccountId) throw new ActionError("Select the destination account.", { toAccountId: "Required for transfers" });
    if (input.toAccountId === input.accountId) throw new ActionError("Choose two different accounts.", { toAccountId: "Must differ from source" });
    const to = await db.account.findUnique({ where: { id: input.toAccountId } });
    if (!to) throw new ActionError("Destination account not found.");
    if (input.date < to.openingDate) throw new ActionError(`Date is before the opening date of ${to.name}.`, { date: "Before account opening date" });
    return { ...input, categoryId: null, taxAmount: "0", vendorBillId: null };
  }
  if (!input.categoryId) throw new ActionError("Select a category.", { categoryId: "Category is required" });
  const cat = await db.category.findUnique({ where: { id: input.categoryId } });
  if (!cat || cat.type !== input.type) throw new ActionError("Category doesn't match the transaction type.", { categoryId: "Wrong category type" });
  if (cat.name === "Client Payments" && cat.isSystem) {
    throw new ActionError("Client payments against invoices must be recorded from the invoice (Record payment) so revenue isn't counted twice.", { categoryId: "Use Record payment on the invoice" });
  }
  if (D(input.taxAmount).gt(D(input.amount))) throw new ActionError("Input GST cannot exceed the amount.", { taxAmount: "Exceeds amount" });
  if (input.type === "INCOME" && D(input.taxAmount).gt(0)) throw new ActionError("Input GST applies to expenses only.", { taxAmount: "Expenses only" });
  if (input.vendorBillId) {
    if (input.type !== "EXPENSE") throw new ActionError("Only expenses can pay a vendor bill.");
    const bill = await db.vendorBill.findUnique({ where: { id: input.vendorBillId } });
    if (!bill || bill.status === "CANCELLED") throw new ActionError("Vendor bill not found or cancelled.");
    return { ...input, toAccountId: null, vendorId: bill.vendorId, taxAmount: "0" };
  }
  return { ...input, toAccountId: null };
}

export async function saveTransaction(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("finance", "EDIT");
    const raw = formToObject(fd);
    const file = raw.attachment instanceof File && raw.attachment.size > 0 ? raw.attachment : null;
    delete raw.attachment;
    const input = await validateTxn(txnSchema.parse(raw));
    const txnId = await db.$transaction(async (tx) => {
      let tid: string;
      if (id) {
        const before = await tx.transaction.findUniqueOrThrow({ where: { id } });
        if (before.paymentId) throw new ActionError("This transaction belongs to an invoice payment. Void the payment from the invoice instead.");
        if (before.deletedAt) throw new ActionError("This transaction was deleted.");
        await tx.transaction.update({ where: { id }, data: input });
        if (before.vendorBillId) await recalcVendorBill(tx, before.vendorBillId);
        await audit({ userId: user.id, action: "UPDATE", entityType: "Transaction", entityId: id, summary: `${input.type.toLowerCase()} “${input.description}” updated`, changes: diff(before, input) }, tx);
        tid = id;
      } else {
        const t = await tx.transaction.create({ data: { ...input, createdById: user.id } });
        await audit({ userId: user.id, action: "CREATE", entityType: "Transaction", entityId: t.id, summary: `${input.type.toLowerCase()} ₹${input.amount} — ${input.description}` }, tx);
        emitEvent("transaction.created", t);
        tid = t.id;
      }
      if (input.vendorBillId) await recalcVendorBill(tx, input.vendorBillId);
      return tid;
    });
    if (file) {
      const stored = await storeUpload(file, user.id);
      await db.document.create({
        data: {
          title: `Receipt — ${input.description}`.slice(0, 200),
          category: input.vendorBillId ? "PURCHASE_BILL" : "OTHER",
          fileId: stored.id,
          transactionId: txnId,
          vendorId: input.vendorId,
          clientId: input.clientId,
          projectId: input.projectId,
          uploadedById: user.id,
        },
      });
    }
    revalidateFinance();
    revalidatePath("/vendors", "layout");
    return { ok: true, message: "Transaction saved" };
  });
}

export async function deleteTransaction(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("finance", "FULL");
    await db.$transaction(async (tx) => {
      const t = await tx.transaction.findUniqueOrThrow({ where: { id } });
      if (t.paymentId) throw new ActionError("This is an invoice payment. Void it from the invoice so the invoice balance stays correct.");
      await tx.transaction.update({ where: { id }, data: { deletedAt: new Date() } });
      if (t.vendorBillId) await recalcVendorBill(tx, t.vendorBillId);
      await audit({ userId: user.id, action: "DELETE", entityType: "Transaction", entityId: id, summary: `Deleted ${t.type.toLowerCase()} ₹${t.amount.toFixed(2)} — ${t.description}` }, tx);
    });
    revalidateFinance();
    return { ok: true, message: "Transaction deleted" };
  });
}
