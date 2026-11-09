import Link from "next/link";
import { Ban, FileText, Pencil, Plus, Wallet, Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams, orderByField } from "@/lib/list";
import { D, formatMoney } from "@/lib/money";
import { fmtDate, isoDate, todayIST } from "@/lib/dates";
import { accountOptions, categoryOptions, PAYMENT_METHOD_OPTIONS, projectOptions, vendorOptions } from "@/lib/options";
import { PageHeader, StatCard } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { cancelBill, payBill, saveBill } from "@/server/actions/vendors";
import { billDefaults, billFields, payFields } from "../fields";

export const metadata = { title: "Purchase Bills" };

export default async function BillsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("vendors");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["billDate", "dueDate", "total"] as const, defaultSort: "billDate" });
  const today = todayIST();
  const status = param(sp, "status");
  const where: Prisma.VendorBillWhereInput = {
    deletedAt: null,
    ...(status === "OVERDUE" ? { status: { in: ["UNPAID", "PARTIALLY_PAID"] }, dueDate: { lt: today } } : status ? { status: status as "UNPAID" } : {}),
    ...(param(sp, "vendorId") ? { vendorId: param(sp, "vendorId") } : {}),
    ...(param(sp, "categoryId") ? { categoryId: param(sp, "categoryId") } : {}),
    ...(param(sp, "projectId") ? { projectId: param(sp, "projectId") } : {}),
    ...(list.q ? { OR: [{ billNumber: { contains: list.q, mode: "insensitive" } }, { description: { contains: list.q, mode: "insensitive" } }, { vendor: { name: { contains: list.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, vendors, categories, projects, accounts, openAgg] = await Promise.all([
    db.vendorBill.findMany({ where, include: { vendor: { select: { name: true } }, category: { select: { name: true } }, project: { select: { name: true } }, documents: { where: { deletedAt: null }, select: { fileId: true }, take: 1 } }, orderBy: [orderByField(list.sort, list.dir, ["dueDate"])], skip: list.skip, take: list.pageSize }),
    db.vendorBill.count({ where }),
    vendorOptions(),
    categoryOptions("EXPENSE"),
    projectOptions(),
    accountOptions(),
    db.vendorBill.aggregate({ where: { deletedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, _sum: { total: true, amountPaid: true }, _count: true }),
  ]);
  const overdueAgg = await db.vendorBill.aggregate({ where: { deletedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] }, dueDate: { lt: today } }, _sum: { total: true, amountPaid: true }, _count: true });
  const o = { vendors, categories, projects };
  const canEdit = can(user.access, "vendors", "EDIT");
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "bill", header: "Bill", render: (b) => <span><span className="block font-mono text-[13px]">{b.billNumber}</span><Link href={`/vendors/${b.vendorId}`} className="text-xs text-brand">{b.vendor.name}</Link></span> },
    { key: "date", header: "Date", sortKey: "billDate", render: (b) => fmtDate(b.billDate) },
    { key: "due", header: "Due", sortKey: "dueDate", render: (b) => <span className={b.dueDate && b.dueDate < today && ["UNPAID", "PARTIALLY_PAID"].includes(b.status) ? "font-medium text-danger" : ""}>{fmtDate(b.dueDate)}</span> },
    { key: "cat", header: "Category", render: (b) => <span className="text-[13px]">{b.category.name}{b.project ? <span className="block text-xs text-muted">{b.project.name}</span> : null}</span> },
    { key: "status", header: "Status", render: (b) => <StatusBadge status={b.dueDate && b.dueDate < today && ["UNPAID", "PARTIALLY_PAID"].includes(b.status) ? "OVERDUE" : b.status} /> },
    { key: "total", header: "Total", sortKey: "total", align: "right", render: (b) => <span>{formatMoney(b.total)}{b.taxAmount.gt(0) ? <span className="block text-xs text-muted">GST {formatMoney(b.taxAmount)}</span> : null}</span> },
    { key: "bal", header: "Balance", align: "right", render: (b) => (b.status === "CANCELLED" ? "—" : formatMoney(D(b.total).minus(D(b.amountPaid)))) },
    {
      key: "a", header: "", align: "right",
      render: (b) => (
        <div className="flex justify-end gap-1">
          {b.documents[0] ? <a href={`/api/files/${b.documents[0].fileId}`} target="_blank" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2" title="View bill"><FileText className="h-4 w-4" /></a> : null}
          {canEdit && ["UNPAID", "PARTIALLY_PAID"].includes(b.status) ? (
            <FormDialog trigger={<Wallet />} triggerVariant="ghost" triggerSize="icon-sm" title={`Pay ${b.vendor.name} — ${b.billNumber}`} description={`Outstanding ${formatMoney(D(b.total).minus(D(b.amountPaid)))}. Creates an expense transaction linked to this bill.`}
              fields={payFields(accounts, PAYMENT_METHOD_OPTIONS)} defaults={{ date: isoDate(today), amount: D(b.total).minus(D(b.amountPaid)).toFixed(2), accountId: accounts[0]?.value, method: "BANK_TRANSFER" }} action={payBill.bind(null, b.id)} submitLabel="Record payment" />
          ) : null}
          {canEdit && b.status !== "CANCELLED" ? <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit bill" fields={billFields(o, false)} defaults={billDefaults(b)} action={saveBill.bind(null, b.id)} size="lg" /> : null}
          {can(user.access, "vendors", "FULL") && b.status === "UNPAID" ? <ConfirmAction action={cancelBill.bind(null, b.id)} label={<Ban />} variant="ghost" size="icon-sm" title="Cancel this bill?" reasonLabel="Reason" reasonRequired confirmLabel="Cancel bill" /> : null}
        </div>
      ),
    },
  ];
  const openDue = D(openAgg._sum.total).minus(D(openAgg._sum.amountPaid));
  const overdue = D(overdueAgg._sum.total).minus(D(overdueAgg._sum.amountPaid));
  return (
    <>
      <PageHeader
        title="Purchase Bills"
        description="Vendor invoices you owe. Bills are expensed on the bill date; payments reduce what you owe."
        actions={
          <>
            <LinkButton href="/api/export/bills" variant="outline"><Download /> CSV</LinkButton>
            {canEdit ? <FormDialog trigger={<><Plus /> Record bill</>} title="Record purchase bill" fields={billFields(o)} defaults={{ billDate: isoDate(today), taxAmount: "0", vendorId: param(sp, "vendorId") }} action={saveBill.bind(null, null)} size="lg" /> : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Accounts payable" value={formatMoney(openDue)} hint={`${openAgg._count} unpaid bill(s)`} />
        <StatCard label="Overdue" value={formatMoney(overdue)} tone={overdue.gt(0) ? "danger" : "default"} hint={`${overdueAgg._count} bill(s)`} href="/vendors/bills?status=OVERDUE" />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/vendors/bills"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={
          <ListToolbar
            placeholder="Search bill number, vendor…"
            filters={[
              { type: "select", name: "status", label: "Status", options: [{ value: "UNPAID", label: "Unpaid" }, { value: "PARTIALLY_PAID", label: "Partially paid" }, { value: "OVERDUE", label: "Overdue" }, { value: "PAID", label: "Paid" }, { value: "CANCELLED", label: "Cancelled" }] },
              { type: "select", name: "vendorId", label: "Vendor", options: vendors },
              { type: "select", name: "categoryId", label: "Category", options: categories },
              { type: "select", name: "projectId", label: "Project", options: projects },
            ]}
          />
        }
        empty={{ icon: <FileText />, title: "No bills", description: vendors.length ? "Record vendor invoices to track payables and due dates." : "Add a vendor first." }}
      />
    </>
  );
}
