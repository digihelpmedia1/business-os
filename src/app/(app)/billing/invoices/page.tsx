import { Plus, ReceiptText } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, withParams, type SearchParams, orderByField } from "@/lib/list";
import { formatMoney, D, Decimal } from "@/lib/money";
import { fmtDate, todayIST, toDateOnly } from "@/lib/dates";
import { clientOptions } from "@/lib/options";
import { effectiveInvoiceStatus, invoiceOutstanding } from "@/lib/finance/ledger";
import { INVOICE_TYPE_LABELS } from "@/lib/finance/constants";
import { PageHeader, StatCard } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { DataTable, LinkTabs, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { StatusBadge } from "@/components/status-badge";

export const metadata = { title: "Invoices & Notes" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("billing");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["issueDate", "dueDate", "number", "total"] as const, defaultSort: "issueDate" });
  const today = todayIST();
  const type = param(sp, "type");
  const status = param(sp, "status");
  const clientId = param(sp, "clientId");
  const from = param(sp, "from");
  const to = param(sp, "to");
  const statusWhere: Prisma.InvoiceWhereInput =
    status === "OVERDUE"
      ? { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: today }, type: { not: "CREDIT_NOTE" } }
      : status === "OPEN"
        ? { status: { in: ["DRAFT", "ISSUED", "PARTIALLY_PAID"] }, type: { not: "CREDIT_NOTE" } }
        : status
          ? { status: status as "DRAFT" }
          : {};
  const dateWhere: Prisma.InvoiceWhereInput = {};
  try {
    if (from || to) dateWhere.issueDate = { ...(from ? { gte: toDateOnly(from) } : {}), ...(to ? { lte: toDateOnly(to) } : {}) };
  } catch {
    /* ignore invalid dates */
  }
  const where: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...(type ? { type: type as "TAX_INVOICE" } : {}),
    ...(clientId ? { clientId } : {}),
    ...(param(sp, "projectId") ? { projectId: param(sp, "projectId") } : {}),
    ...(param(sp, "recurring") ? { recurringProfileId: param(sp, "recurring") } : {}),
    ...statusWhere,
    ...dateWhere,
    ...(list.q ? { OR: [{ number: { contains: list.q, mode: "insensitive" } }, { clientName: { contains: list.q, mode: "insensitive" } }, { client: { name: { contains: list.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, clients, openAgg, overdueAgg, drafts] = await Promise.all([
    db.invoice.findMany({ where, include: { client: { select: { name: true } } }, orderBy: [orderByField(list.sort, list.dir, ["dueDate", "number"]), { createdAt: "desc" }], skip: list.skip, take: list.pageSize }),
    db.invoice.count({ where }),
    clientOptions(),
    db.invoice.aggregate({ where: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, type: { in: ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"] } }, _sum: { total: true, amountPaid: true, amountCredited: true }, _count: true }),
    db.invoice.aggregate({ where: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, type: { in: ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"] }, dueDate: { lt: today } }, _sum: { total: true, amountPaid: true, amountCredited: true }, _count: true }),
    db.invoice.count({ where: { deletedAt: null, status: "DRAFT" } }),
  ]);
  const out = (a: { _sum: { total: Decimal | null; amountPaid: Decimal | null; amountCredited: Decimal | null } }) =>
    D(a._sum.total).minus(D(a._sum.amountPaid)).minus(D(a._sum.amountCredited));

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "number", header: "Number", sortKey: "number", render: (i) => <span className="font-mono text-[13px]">{i.number ?? "Draft"}</span> },
    { key: "client", header: "Client", render: (i) => <span><span className="block">{i.clientName ?? i.client.name}</span><span className="text-xs text-muted">{INVOICE_TYPE_LABELS[i.type]}{i.periodLabel ? ` · ${i.periodLabel}` : ""}</span></span> },
    { key: "date", header: "Date", sortKey: "issueDate", render: (i) => fmtDate(i.issueDate) },
    { key: "due", header: "Due", sortKey: "dueDate", render: (i) => fmtDate(i.dueDate) },
    { key: "status", header: "Status", render: (i) => <StatusBadge status={effectiveInvoiceStatus(i, today)} /> },
    { key: "total", header: "Total", sortKey: "total", align: "right", render: (i) => <span className={i.type === "CREDIT_NOTE" ? "text-danger" : ""}>{i.type === "CREDIT_NOTE" ? "−" : ""}{formatMoney(i.total)}</span> },
    { key: "balance", header: "Balance", align: "right", render: (i) => (i.type === "CREDIT_NOTE" || i.status === "DRAFT" || i.status === "CANCELLED" ? <span className="text-muted">—</span> : formatMoney(invoiceOutstanding(i))) },
  ];
  const tab = status ?? "all";
  return (
    <>
      <PageHeader
        title="Invoices & Notes"
        description="GST & non-GST invoices, proforma and advance invoices, credit and debit notes."
        actions={
          can(user.access, "billing", "EDIT") ? (
            <>
              <LinkButton href="/billing/invoices/new?type=CREDIT_NOTE" variant="outline">Credit / debit note</LinkButton>
              <LinkButton href="/billing/invoices/new"><Plus /> New invoice</LinkButton>
            </>
          ) : null
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Outstanding" value={formatMoney(out(openAgg))} hint={`${openAgg._count} open invoice(s)`} />
        <StatCard label="Overdue" value={formatMoney(out(overdueAgg))} tone={out(overdueAgg).gt(0) ? "danger" : "default"} hint={`${overdueAgg._count} invoice(s)`} href="/billing/invoices?status=OVERDUE" />
        <StatCard label="Drafts" value={drafts} hint="Not yet issued" href="/billing/invoices?status=DRAFT" />
        <StatCard label="Showing" value={total} hint="Matching current filters" />
      </div>
      <LinkTabs
        active={tab}
        tabs={[
          { key: "all", label: "All", href: withParams("/billing/invoices", sp, { status: null, page: null }) },
          { key: "OPEN", label: "Open", href: withParams("/billing/invoices", sp, { status: "OPEN", page: null }) },
          { key: "OVERDUE", label: "Overdue", href: withParams("/billing/invoices", sp, { status: "OVERDUE", page: null }) },
          { key: "DRAFT", label: "Drafts", href: withParams("/billing/invoices", sp, { status: "DRAFT", page: null }) },
          { key: "PAID", label: "Paid", href: withParams("/billing/invoices", sp, { status: "PAID", page: null }) },
          { key: "CANCELLED", label: "Cancelled", href: withParams("/billing/invoices", sp, { status: "CANCELLED", page: null }) },
        ]}
      />
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/billing/invoices"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        rowHref={(i) => `/billing/invoices/${i.id}`}
        toolbar={
          <ListToolbar
            placeholder="Search number or client…"
            filters={[
              { type: "select", name: "type", label: "Type", options: Object.entries(INVOICE_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
              { type: "select", name: "clientId", label: "Client", options: clients },
              { type: "date", name: "from", label: "From" },
              { type: "date", name: "to", label: "To" },
            ]}
          />
        }
        empty={{ icon: <ReceiptText />, title: "No invoices found", description: "Create an invoice, convert an accepted quotation, or set up a recurring invoice for retainers." }}
      />
    </>
  );
}
