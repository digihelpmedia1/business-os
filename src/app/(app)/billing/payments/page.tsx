import Link from "next/link";
import { Wallet } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseList, param, type SearchParams } from "@/lib/list";
import { formatMoney, D } from "@/lib/money";
import { fmtDate, toDateOnly } from "@/lib/dates";
import { clientOptions, PAYMENT_METHOD_OPTIONS } from "@/lib/options";
import { PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";

export const metadata = { title: "Payments & Receipts" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageAccess("billing");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["paymentDate", "amount", "receiptNumber"] as const, defaultSort: "paymentDate" });
  const clientId = param(sp, "clientId");
  const method = param(sp, "method");
  const voided = param(sp, "voided");
  const from = param(sp, "from");
  const to = param(sp, "to");
  let dateWhere: Prisma.PaymentWhereInput = {};
  try {
    if (from || to) dateWhere = { paymentDate: { ...(from ? { gte: toDateOnly(from) } : {}), ...(to ? { lte: toDateOnly(to) } : {}) } };
  } catch {
    /* ignore */
  }
  const where: Prisma.PaymentWhereInput = {
    ...(voided === "1" ? { voidedAt: { not: null } } : { voidedAt: null }),
    ...(clientId ? { clientId } : {}),
    ...(method ? { method: method as "UPI" } : {}),
    ...dateWhere,
    ...(list.q ? { OR: [{ receiptNumber: { contains: list.q, mode: "insensitive" } }, { reference: { contains: list.q, mode: "insensitive" } }, { invoice: { number: { contains: list.q, mode: "insensitive" } } }, { client: { name: { contains: list.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, sums, clients] = await Promise.all([
    db.payment.findMany({ where, include: { client: { select: { name: true } }, invoice: { select: { id: true, number: true } }, account: { select: { name: true } } }, orderBy: [{ [list.sort]: list.dir }, { createdAt: "desc" }], skip: list.skip, take: list.pageSize }),
    db.payment.count({ where }),
    db.payment.aggregate({ where, _sum: { amount: true, tdsAmount: true } }),
    clientOptions(),
  ]);
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "receipt", header: "Receipt", sortKey: "receiptNumber", render: (p) => <a href={`/api/pdf/receipt/${p.id}`} target="_blank" className="font-mono text-[13px] text-brand">{p.receiptNumber}</a> },
    { key: "date", header: "Date", sortKey: "paymentDate", render: (p) => fmtDate(p.paymentDate) },
    { key: "client", header: "Client", render: (p) => p.client.name },
    { key: "invoice", header: "Invoice", render: (p) => <Link href={`/billing/invoices/${p.invoice.id}`} className="text-brand">{p.invoice.number}</Link> },
    { key: "method", header: "Method", render: (p) => <span className="text-[13px]">{PAYMENT_METHOD_OPTIONS.find((m) => m.value === p.method)?.label}<span className="block text-xs text-muted">{p.account.name}{p.reference ? ` · ${p.reference}` : ""}</span></span> },
    { key: "tds", header: "TDS", align: "right", render: (p) => (p.tdsAmount.gt(0) ? formatMoney(p.tdsAmount) : "—") },
    { key: "amount", header: "Amount", sortKey: "amount", align: "right", render: (p) => (p.voidedAt ? <Badge tone="danger">Voided</Badge> : <span className="font-medium">{formatMoney(p.amount)}</span>) },
  ];
  return (
    <>
      <PageHeader title="Payments & Receipts" description="Every client payment recorded against an invoice, with downloadable receipts. Record payments from the invoice page." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Cash received" value={formatMoney(sums._sum.amount)} hint="Matching filters" />
        <StatCard label="TDS deducted by clients" value={formatMoney(sums._sum.tdsAmount)} hint="Claim against Form 26AS" />
        <StatCard label="Total settled" value={formatMoney(D(sums._sum.amount).plus(D(sums._sum.tdsAmount)))} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/billing/payments"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={
          <ListToolbar
            placeholder="Search receipt, invoice, reference…"
            filters={[
              { type: "select", name: "clientId", label: "Client", options: clients },
              { type: "select", name: "method", label: "Method", options: PAYMENT_METHOD_OPTIONS },
              { type: "select", name: "voided", label: "Voided", options: [{ value: "1", label: "Show voided" }] },
              { type: "date", name: "from", label: "From" },
              { type: "date", name: "to", label: "To" },
            ]}
          />
        }
        empty={{ icon: <Wallet />, title: "No payments found", description: "Open an issued invoice and click “Record payment”." }}
      />
    </>
  );
}
