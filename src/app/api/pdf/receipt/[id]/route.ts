import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { companyLogo } from "@/lib/storage";
import { renderReceiptPdf } from "@/lib/pdf/render";
import { D, Decimal, formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/options";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !can(user.access, "billing")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const p = await db.payment.findUnique({ where: { id }, include: { invoice: true, client: true } });
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Balance immediately after this payment (payments up to and including this one).
  const prior = await db.payment.findMany({
    where: { invoiceId: p.invoiceId, voidedAt: null, OR: [{ paymentDate: { lt: p.paymentDate } }, { paymentDate: p.paymentDate, createdAt: { lte: p.createdAt } }] },
    select: { amount: true, tdsAmount: true },
  });
  const settled = prior.reduce((a, x) => a.plus(D(x.amount)).plus(D(x.tdsAmount)), new Decimal(0));
  const balance = Decimal.max(D(p.invoice.total).minus(settled).minus(D(p.invoice.amountCredited)), 0);
  const [settings, logo] = await Promise.all([getSettings(), companyLogo()]);
  const pdf = await renderReceiptPdf({
    company: settings,
    logo,
    receiptNumber: p.receiptNumber,
    date: fmtDate(p.paymentDate),
    clientName: p.invoice.clientName ?? p.client.businessName ?? p.client.name,
    clientLines: [p.invoice.clientAddress, p.invoice.clientGstin ? `GSTIN: ${p.invoice.clientGstin}` : null],
    invoiceNumber: p.invoice.number ?? "—",
    invoiceTotal: formatMoney(p.invoice.total),
    amount: formatMoney(p.amount),
    tds: formatMoney(p.tdsAmount),
    method: PAYMENT_METHOD_OPTIONS.find((m) => m.value === p.method)?.label ?? p.method,
    reference: p.reference,
    balance: formatMoney(balance),
    voided: !!p.voidedAt,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${p.receiptNumber.replace(/\//g, "-")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
