import { ScrollText } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseList, param, type SearchParams } from "@/lib/list";
import { fmtDateTime, toDateOnly, addDays } from "@/lib/dates";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";

export const metadata = { title: "Audit Log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageAccess("users");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["createdAt"] as const, defaultSort: "createdAt", pageSize: 50 });
  let createdAt: Prisma.DateTimeFilter | undefined;
  try {
    if (param(sp, "from") || param(sp, "to")) createdAt = { ...(param(sp, "from") ? { gte: toDateOnly(param(sp, "from")!) } : {}), ...(param(sp, "to") ? { lt: addDays(toDateOnly(param(sp, "to")!), 1) } : {}) };
  } catch {
    createdAt = undefined;
  }
  const where: Prisma.AuditLogWhereInput = {
    ...(param(sp, "entityType") ? { entityType: param(sp, "entityType") } : {}),
    ...(param(sp, "action") ? { action: param(sp, "action") } : {}),
    ...(param(sp, "userId") ? { userId: param(sp, "userId") } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(list.q ? { summary: { contains: list.q, mode: "insensitive" } } : {}),
  };
  const [rows, total, types, actions, users] = await Promise.all([
    db.auditLog.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: list.dir }, skip: list.skip, take: list.pageSize }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "when", header: "When", sortKey: "createdAt", render: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDateTime(r.createdAt)}</span> },
    { key: "who", header: "User", render: (r) => <span className="text-[13px]">{r.user?.name ?? "System / API"}</span> },
    { key: "action", header: "Action", render: (r) => <Badge tone={r.action.includes("DELETE") || r.action.includes("CANCEL") || r.action.includes("VOID") || r.action.includes("FAILED") ? "danger" : r.action === "CREATE" ? "success" : "neutral"}>{r.action}</Badge> },
    { key: "entity", header: "Record", render: (r) => <span className="text-[13px]">{r.entityType}</span> },
    {
      key: "summary", header: "Details",
      render: (r) => (
        <div className="max-w-xl text-[13px]">
          <p>{r.summary}</p>
          {r.changes && typeof r.changes === "object" && Object.keys(r.changes as object).length ? (
            <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Changes</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2">{JSON.stringify(r.changes, null, 2)}</pre></details>
          ) : null}
          {r.ipAddress ? <p className="text-xs text-subtle">IP {r.ipAddress}</p> : null}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Audit Log" description="A permanent record of sign-ins, financial changes, document actions, exports and settings changes." />
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/settings/audit"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={
          <ListToolbar
            placeholder="Search details…"
            filters={[
              { type: "select", name: "entityType", label: "Record", options: types.map((t) => ({ value: t.entityType, label: t.entityType })) },
              { type: "select", name: "action", label: "Action", options: actions.map((a) => ({ value: a.action, label: a.action })) },
              { type: "select", name: "userId", label: "User", options: users.map((u) => ({ value: u.id, label: u.name })) },
              { type: "date", name: "from", label: "From" },
              { type: "date", name: "to", label: "To" },
            ]}
          />
        }
        empty={{ icon: <ScrollText />, title: "No audit entries match" }}
      />
    </>
  );
}
