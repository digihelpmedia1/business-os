import { Plus, Truck } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams } from "@/lib/list";
import { D, formatMoney } from "@/lib/money";
import { fyOf, todayIST } from "@/lib/dates";
import { PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { saveVendor } from "@/server/actions/vendors";
import { VENDOR_CATEGORIES, vendorDefaults, vendorFields } from "./fields";

export const metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("vendors");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["name", "createdAt"] as const, defaultSort: "name", defaultDir: "asc" });
  const category = param(sp, "category");
  const where: Prisma.VendorWhereInput = {
    deletedAt: null,
    ...(category ? { category } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" } }, { gstin: { contains: list.q, mode: "insensitive" } }, { email: { contains: list.q, mode: "insensitive" } }, { contactPerson: { contains: list.q, mode: "insensitive" } }] } : {}),
  };
  const fy = fyOf(todayIST());
  const [rows, total] = await Promise.all([
    db.vendor.findMany({ where, orderBy: { [list.sort]: list.dir }, skip: list.skip, take: list.pageSize }),
    db.vendor.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const [spend, open] = await Promise.all([
    db.transaction.groupBy({ by: ["vendorId"], where: { vendorId: { in: ids }, type: "EXPENSE", deletedAt: null, date: { gte: fy.from, lte: fy.to } }, _sum: { amount: true } }),
    db.vendorBill.groupBy({ by: ["vendorId"], where: { vendorId: { in: ids }, deletedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, _sum: { total: true, amountPaid: true } }),
  ]);
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "name", header: "Vendor", sortKey: "name", render: (v) => <span><span className="block">{v.name}</span><span className="text-xs text-muted">{v.category ?? "—"}</span></span> },
    { key: "contact", header: "Contact", render: (v) => <span className="text-[13px]">{v.contactPerson ?? v.email ?? "—"}<span className="block text-xs text-muted">{v.phone}</span></span> },
    { key: "gstin", header: "GSTIN", render: (v) => <span className="font-mono text-xs">{v.gstin ?? "—"}</span> },
    { key: "status", header: "Status", render: (v) => <StatusBadge status={v.isActive ? "ACTIVE" : "INACTIVE"} /> },
    { key: "spend", header: `Paid (${fy.label})`, align: "right", render: (v) => formatMoney(D(spend.find((s) => s.vendorId === v.id)?._sum.amount)) },
    { key: "due", header: "Payable", align: "right", render: (v) => { const o = open.find((x) => x.vendorId === v.id); const due = o ? D(o._sum.total).minus(D(o._sum.amountPaid)) : D(0); return due.gt(0) ? <span className="font-medium text-warning">{formatMoney(due)}</span> : <span className="text-muted">—</span>; } },
  ];
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Suppliers, freelancers and service providers — with bills, payments and spend."
        actions={can(user.access, "vendors", "EDIT") ? <FormDialog trigger={<><Plus /> New vendor</>} title="New vendor" description="Duplicates are blocked by name and GSTIN." fields={vendorFields} defaults={vendorDefaults()} action={saveVendor.bind(null, null)} size="lg" /> : null}
      />
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/vendors"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        rowHref={(v) => `/vendors/${v.id}`}
        toolbar={<ListToolbar placeholder="Search name, GSTIN, email…" filters={[{ type: "select", name: "category", label: "Category", options: VENDOR_CATEGORIES.map((c) => ({ value: c, label: c })) }]} />}
        empty={{ icon: <Truck />, title: "No vendors yet", description: "Add the tools, freelancers and suppliers you pay." }}
      />
    </>
  );
}
