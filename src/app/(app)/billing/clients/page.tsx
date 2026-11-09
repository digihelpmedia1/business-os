import { Plus, Users } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams } from "@/lib/list";
import { D, Decimal, formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/primitives";
import { saveClient } from "@/server/actions/clients";
import { clientDefaults, clientFields } from "./fields";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("billing");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["name", "createdAt", "status"] as const, defaultSort: "name", defaultDir: "asc" });
  const status = param(sp, "status");
  const source = param(sp, "source");
  const archived = param(sp, "archived") === "1";
  const where: Prisma.ClientWhereInput = {
    deletedAt: archived ? { not: null } : null,
    ...(status ? { status: status as "ACTIVE" } : {}),
    ...(source === "crm" ? { externalCrmId: { not: null } } : source === "manual" ? { externalCrmId: null } : {}),
    ...(list.q
      ? { OR: ["name", "businessName", "email", "phone", "gstin", "city"].map((f) => ({ [f]: { contains: list.q, mode: "insensitive" } })) }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.client.findMany({ where, orderBy: { [list.sort]: list.dir }, skip: list.skip, take: list.pageSize }),
    db.client.count({ where }),
  ]);
  const outstanding = await db.invoice.groupBy({
    by: ["clientId"],
    where: { clientId: { in: rows.map((r) => r.id) }, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, type: { in: ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"] }, deletedAt: null },
    _sum: { total: true, amountPaid: true, amountCredited: true },
  });
  const due = (id: string) => {
    const o = outstanding.find((x) => x.clientId === id);
    return o ? Decimal.max(D(o._sum.total).minus(D(o._sum.amountPaid)).minus(D(o._sum.amountCredited)), 0) : new Decimal(0);
  };

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "name", header: "Client", sortKey: "name", render: (c) => <span><span className="block">{c.name}</span>{c.businessName ? <span className="block text-xs text-muted">{c.businessName}</span> : null}</span> },
    { key: "contact", header: "Contact", render: (c) => <span className="text-[13px]"><span className="block">{c.email ?? "—"}</span><span className="block text-xs text-muted">{c.phone}</span></span> },
    { key: "gstin", header: "GSTIN", render: (c) => <span className="font-mono text-xs">{c.gstin ?? "Unregistered"}</span> },
    { key: "location", header: "Location", render: (c) => [c.city, c.state].filter(Boolean).join(", ") || "—" },
    { key: "source", header: "Source", render: (c) => (c.externalCrmId ? <Badge tone="info">CRM</Badge> : <Badge>Manual</Badge>) },
    { key: "status", header: "Status", sortKey: "status", render: (c) => <StatusBadge status={c.status} /> },
    { key: "due", header: "Outstanding", align: "right", render: (c) => (due(c.id).gt(0) ? <span className="font-medium text-warning">{formatMoney(due(c.id))}</span> : <span className="text-muted">—</span>) },
  ];

  return (
    <>
      <PageHeader
        title="Clients"
        description="Clients you bill. Sync from your CRM (Settings → CRM Integration) or add them manually."
        actions={
          can(user.access, "billing", "EDIT") ? (
            <FormDialog trigger={<><Plus /> New client</>} title="New client" fields={clientFields} defaults={clientDefaults()} action={saveClient.bind(null, null)} size="lg" />
          ) : null
        }
      />
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/billing/clients"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        rowHref={(c) => `/billing/clients/${c.id}`}
        toolbar={
          <ListToolbar
            placeholder="Search name, email, phone, GSTIN…"
            filters={[
              { type: "select", name: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "CHURNED", label: "Churned" }] },
              { type: "select", name: "source", label: "Source", options: [{ value: "crm", label: "From CRM" }, { value: "manual", label: "Manual" }] },
              { type: "select", name: "archived", label: "Archived", options: [{ value: "1", label: "Show archived" }] },
            ]}
          />
        }
        empty={{ icon: <Users />, title: list.q || status ? "No clients match your filters" : "No clients yet", description: "Add your first client to start creating quotations and invoices." }}
      />
    </>
  );
}
