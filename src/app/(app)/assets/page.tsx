import { Laptop, Plus, Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams, orderByField } from "@/lib/list";
import { D, formatMoney } from "@/lib/money";
import { fmtDate, todayIST, addDays } from "@/lib/dates";
import { employeeOptions, vendorOptions } from "@/lib/options";
import { PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { saveAsset } from "@/server/actions/assets";
import { ASSET_CATEGORIES, ASSET_STATUSES, assetDefaults, assetFields } from "./fields";

export const metadata = { title: "Company Assets" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("assets");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["name", "purchaseDate", "purchaseValue", "warrantyUntil"] as const, defaultSort: "name", defaultDir: "asc" });
  const today = todayIST();
  const where: Prisma.AssetWhereInput = {
    deletedAt: null,
    ...(param(sp, "category") ? { category: param(sp, "category") as "LAPTOP" } : {}),
    ...(param(sp, "status") ? { status: param(sp, "status") as "IN_USE" } : {}),
    ...(param(sp, "assignedEmployeeId") ? { assignedEmployeeId: param(sp, "assignedEmployeeId") } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" } }, { serialNumber: { contains: list.q, mode: "insensitive" } }, { brand: { contains: list.q, mode: "insensitive" } }, { model: { contains: list.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, agg, warranty, vendors, employees] = await Promise.all([
    db.asset.findMany({ where, include: { assignedEmployee: { select: { name: true } } }, orderBy: [orderByField(list.sort, list.dir, ["purchaseDate", "warrantyUntil"])], skip: list.skip, take: list.pageSize }),
    db.asset.count({ where }),
    db.asset.aggregate({ where: { deletedAt: null, status: { notIn: ["SOLD", "LOST", "RETIRED"] } }, _sum: { purchaseValue: true }, _count: true }),
    db.asset.count({ where: { deletedAt: null, warrantyUntil: { gte: today, lte: addDays(today, 60) } } }),
    vendorOptions(),
    employeeOptions(),
  ]);
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "name", header: "Asset", sortKey: "name", render: (a) => <span><span className="block">{a.name}</span><span className="text-xs text-muted">{[a.brand, a.model, a.serialNumber ? `S/N ${a.serialNumber}` : null].filter(Boolean).join(" · ")}</span></span> },
    { key: "cat", header: "Category", render: (a) => <Badge>{ASSET_CATEGORIES.find((c) => c.value === a.category)?.label}</Badge> },
    { key: "assigned", header: "Assigned to", render: (a) => a.assignedEmployee?.name ?? <span className="text-muted">—</span> },
    { key: "purchase", header: "Purchased", sortKey: "purchaseDate", render: (a) => fmtDate(a.purchaseDate) },
    { key: "warranty", header: "Warranty", sortKey: "warrantyUntil", render: (a) => <span className={a.warrantyUntil && a.warrantyUntil < today ? "text-muted line-through" : ""}>{fmtDate(a.warrantyUntil)}</span> },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    { key: "value", header: "Value", sortKey: "purchaseValue", align: "right", render: (a) => formatMoney(a.purchaseValue) },
  ];
  return (
    <>
      <PageHeader
        title="Company Assets"
        description="Laptops, cameras, phones and equipment — who has what, warranty and maintenance."
        actions={
          <>
            <LinkButton href="/api/export/assets" variant="outline"><Download /> CSV</LinkButton>
            {can(user.access, "assets", "EDIT") ? <FormDialog trigger={<><Plus /> Add asset</>} title="Add asset" fields={assetFields({ vendors, employees })} defaults={assetDefaults()} action={saveAsset.bind(null, null)} size="lg" /> : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Assets in service" value={agg._count} />
        <StatCard label="Value at cost" value={formatMoney(D(agg._sum.purchaseValue))} hint="No depreciation applied" />
        <StatCard label="Warranty ending ≤ 60 days" value={warranty} tone={warranty ? "warning" : "default"} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/assets"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        rowHref={(a) => `/assets/${a.id}`}
        toolbar={<ListToolbar placeholder="Search name, serial, brand…" filters={[{ type: "select", name: "category", label: "Category", options: ASSET_CATEGORIES }, { type: "select", name: "status", label: "Status", options: ASSET_STATUSES }, { type: "select", name: "assignedEmployeeId", label: "Assigned to", options: employees }]} />}
        empty={{ icon: <Laptop />, title: "No assets recorded", description: "Add company equipment to track assignment, warranty and maintenance." }}
      />
    </>
  );
}
