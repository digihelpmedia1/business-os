import "server-only";
import type { InvoiceStatus, InvoiceType } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { D, Decimal } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import { OPEN_STATUSES } from "./constants";

export function invoiceOutstanding(inv: { total: unknown; amountPaid: unknown; amountCredited: unknown }): Decimal {
  const out = D(inv.total as string).minus(D(inv.amountPaid as string)).minus(D(inv.amountCredited as string));
  return Decimal.max(out, 0);
}

export type DisplayInvoiceStatus = InvoiceStatus | "OVERDUE";

/** Overdue is derived from the due date — never stored, never stale. */
export function effectiveInvoiceStatus(
  inv: { status: InvoiceStatus; dueDate: Date | null; type: InvoiceType },
  today: Date = todayIST(),
): DisplayInvoiceStatus {
  if (inv.type === "CREDIT_NOTE") return inv.status;
  if (OPEN_STATUSES.includes(inv.status) && inv.dueDate && inv.dueDate < today) return "OVERDUE";
  return inv.status;
}

/**
 * Recompute amountPaid / amountCredited / status of an invoice from its
 * payments and credit notes. Always called inside the mutating transaction.
 */
export async function recalcInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.type === "CREDIT_NOTE") return inv;
  const [paid, credited] = await Promise.all([
    tx.payment.aggregate({ where: { invoiceId, voidedAt: null }, _sum: { amount: true, tdsAmount: true } }),
    tx.invoice.aggregate({
      where: { relatedInvoiceId: invoiceId, type: "CREDIT_NOTE", status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
      _sum: { total: true },
    }),
  ]);
  const amountPaid = D(paid._sum.amount).plus(D(paid._sum.tdsAmount));
  const amountCredited = D(credited._sum.total);
  let status: InvoiceStatus = inv.status;
  if (inv.status !== "DRAFT" && inv.status !== "CANCELLED") {
    const settled = amountPaid.plus(amountCredited);
    status = settled.gte(D(inv.total)) && D(inv.total).gt(0) ? "PAID" : settled.gt(0) ? "PARTIALLY_PAID" : "ISSUED";
  }
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid: amountPaid.toFixed(2), amountCredited: amountCredited.toFixed(2), status },
  });
}

export async function recalcVendorBill(tx: Tx, billId: string) {
  const bill = await tx.vendorBill.findUniqueOrThrow({ where: { id: billId } });
  const paid = await tx.transaction.aggregate({
    where: { vendorBillId: billId, deletedAt: null, type: "EXPENSE" },
    _sum: { amount: true },
  });
  const amountPaid = D(paid._sum.amount);
  let status = bill.status;
  if (status !== "CANCELLED") {
    status = amountPaid.gte(D(bill.total)) ? "PAID" : amountPaid.gt(0) ? "PARTIALLY_PAID" : "UNPAID";
  }
  return tx.vendorBill.update({ where: { id: billId }, data: { amountPaid: amountPaid.toFixed(2), status } });
}

/** Balance of each account as of a date (inclusive). */
export async function accountBalances(asOf: Date = todayIST(), tx: Tx = db) {
  const accounts = await tx.account.findMany({ orderBy: { name: "asc" } });
  const txns = await tx.transaction.groupBy({
    by: ["accountId", "type"],
    where: { deletedAt: null, date: { lte: asOf } },
    _sum: { amount: true },
  });
  const transfersIn = await tx.transaction.groupBy({
    by: ["toAccountId"],
    where: { deletedAt: null, type: "TRANSFER", date: { lte: asOf }, toAccountId: { not: null } },
    _sum: { amount: true },
  });
  return accounts.map((a) => {
    const opening = a.openingDate <= asOf ? D(a.openingBalance) : new Decimal(0);
    const get = (type: string) => D(txns.find((t) => t.accountId === a.id && t.type === type)?._sum.amount);
    const inflow = get("INCOME").plus(D(transfersIn.find((t) => t.toAccountId === a.id)?._sum.amount));
    const outflow = get("EXPENSE").plus(get("TRANSFER"));
    return { ...a, balance: opening.plus(inflow).minus(outflow) };
  });
}

export async function totalCash(asOf: Date = todayIST()) {
  const balances = await accountBalances(asOf);
  return balances.reduce((acc, a) => acc.plus(a.balance), new Decimal(0));
}
