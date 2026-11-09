import Link from "next/link";
import { Briefcase, LayoutGrid, List, Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, withParams, type SearchParams, orderByField } from "@/lib/list";
import { formatMoney, num } from "@/lib/money";
import { fmtDate, todayIST } from "@/lib/dates";
import { clientOptions, employeeOptions, serviceOptions } from "@/lib/options";
import { projectProfitability } from "@/lib/finance/reports";
import { PageHeader, Progress, Card, Badge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { saveProject } from "@/server/actions/projects";
import { PROJECT_STATUS_OPTIONS, projectDefaults, projectFields } from "./fields";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("projects");
  const sp = await searchParams;
  const view = param(sp, "view") === "kanban" ? "kanban" : "list";
  const list = parseList(sp, { sortable: ["name", "endDate", "createdAt", "status"] as const, defaultSort: "createdAt", pageSize: view === "kanban" ? 100 : 20 });
  const status = param(sp, "status");
  const clientId = param(sp, "clientId");
  const managerId = param(sp, "managerId");
  const billingType = param(sp, "billingType");
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...(status ? { status: status as "PLANNING" } : {}),
    ...(clientId ? { clientId } : {}),
    ...(managerId ? { managerId } : {}),
    ...(billingType ? { billingType: billingType as "FIXED" } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" } }, { code: { contains: list.q, mode: "insensitive" } }, { client: { name: { contains: list.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, clients, employees, services] = await Promise.all([
    db.project.findMany({
      where,
      include: { client: { select: { name: true } }, manager: { select: { name: true } }, service: { select: { name: true } }, tasks: { where: { deletedAt: null, parentId: null }, select: { status: true } } },
      orderBy: [orderByField(list.sort, list.dir, ["endDate"])],
      skip: view === "kanban" ? 0 : list.skip,
      take: list.pageSize,
    }),
    db.project.count({ where }),
    clientOptions(),
    employeeOptions(),
    serviceOptions(),
  ]);
  const showFinance = can(user.access, "finance") || can(user.access, "intelligence");
  const profit = showFinance && rows.length ? await projectProfitability(undefined, rows.map((r) => r.id)) : [];
  const today = todayIST();
  const progress = (p: (typeof rows)[number]) => (p.tasks.length ? p.tasks.filter((t) => t.status === "DONE").length / p.tasks.length : 0);

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "name", header: "Project", sortKey: "name", render: (p) => <span><span className="block">{p.name}</span><span className="text-xs text-muted">{[p.client?.name, p.service?.name].filter(Boolean).join(" · ") || "Internal"}</span></span> },
    { key: "status", header: "Status", sortKey: "status", render: (p) => <span className="flex flex-wrap gap-1"><StatusBadge status={p.status} />{p.billingType === "RETAINER" ? <Badge tone="accent">Retainer</Badge> : null}</span> },
    { key: "manager", header: "Manager", render: (p) => p.manager?.name ?? "—" },
    { key: "progress", header: "Progress", render: (p) => <span className="flex min-w-[120px] items-center gap-2"><Progress value={progress(p)} tone={progress(p) === 1 ? "success" : "brand"} /><span className="w-9 text-xs text-muted">{Math.round(progress(p) * 100)}%</span></span> },
    { key: "end", header: "End date", sortKey: "endDate", render: (p) => <span className={p.endDate && p.endDate < today && !["COMPLETED", "CANCELLED"].includes(p.status) ? "text-danger" : ""}>{fmtDate(p.endDate)}</span> },
    ...(showFinance
      ? [{
          key: "profit", header: "Profit", align: "right" as const,
          render: (p: Row) => {
            const pr = profit.find((x) => x.id === p.id);
            if (!pr || (pr.revenue.isZero() && pr.totalCost.isZero())) return <span className="text-muted">—</span>;
            return <span className={pr.profit.lt(0) ? "text-danger" : "text-success"}>{formatMoney(pr.profit, { compact: true })}{pr.margin !== null ? <span className="block text-xs text-muted">{(pr.margin * 100).toFixed(0)}% margin</span> : null}</span>;
          },
        }]
      : []),
  ];

  const canEdit = can(user.access, "projects", "EDIT");
  return (
    <>
      <PageHeader
        title="Projects"
        description="Client projects and monthly retainers — tasks, milestones, time and profitability."
        actions={
          <>
            <div className="flex rounded-lg border border-line-strong p-0.5">
              <Link href={withParams("/projects", sp, { view: null })} className={`rounded-md p-1.5 ${view === "list" ? "bg-brand-soft text-brand" : "text-muted"}`} aria-label="List view"><List className="h-4 w-4" /></Link>
              <Link href={withParams("/projects", sp, { view: "kanban" })} className={`rounded-md p-1.5 ${view === "kanban" ? "bg-brand-soft text-brand" : "text-muted"}`} aria-label="Kanban view"><LayoutGrid className="h-4 w-4" /></Link>
            </div>
            {canEdit ? <FormDialog trigger={<><Plus /> New project</>} title="New project" fields={projectFields({ clients, services, employees })} defaults={projectDefaults()} action={saveProject.bind(null, null)} size="lg" /> : null}
          </>
        }
      />
      {view === "kanban" ? (
        <>
          <Card className="mb-3"><ListToolbar placeholder="Search projects…" filters={[{ type: "select", name: "clientId", label: "Client", options: clients }, { type: "select", name: "managerId", label: "Manager", options: employees }]} /></Card>
          <div className="thin-scroll grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
            {PROJECT_STATUS_OPTIONS.map((col) => {
              const list = rows.filter((r) => r.status === col.value);
              return (
                <div key={col.value} className="flex min-h-[200px] flex-col rounded-xl border border-line bg-surface-2/60 p-2">
                  <div className="flex items-center justify-between px-2 py-1.5"><span className="text-[13px] font-semibold">{col.label}</span><span className="rounded-full bg-surface px-2 text-xs text-muted">{list.length}</span></div>
                  <div className="mt-1 flex flex-col gap-2">
                    {list.map((p) => (
                      <Link key={p.id} href={`/projects/${p.id}`} className="rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow)] hover:border-line-strong">
                        <p className="text-[13px] font-medium">{p.name}</p>
                        <p className="truncate text-xs text-muted">{p.client?.name ?? "Internal"}</p>
                        <div className="mt-2 flex items-center gap-2"><Progress value={progress(p)} /><span className="text-xs text-muted">{Math.round(progress(p) * 100)}%</span></div>
                        <p className="mt-1.5 text-xs text-muted">{p.manager?.name ?? "No manager"}{p.endDate ? ` · due ${fmtDate(p.endDate)}` : ""}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          basePath="/projects"
          searchParams={sp}
          sort={list.sort}
          dir={list.dir}
          total={total}
          page={list.page}
          pageSize={list.pageSize}
          rowHref={(p) => `/projects/${p.id}`}
          toolbar={
            <ListToolbar
              placeholder="Search projects…"
              filters={[
                { type: "select", name: "status", label: "Status", options: PROJECT_STATUS_OPTIONS },
                { type: "select", name: "clientId", label: "Client", options: clients },
                { type: "select", name: "managerId", label: "Manager", options: employees },
                { type: "select", name: "billingType", label: "Billing", options: [{ value: "FIXED", label: "Fixed" }, { value: "RETAINER", label: "Retainer" }, { value: "HOURLY", label: "Hourly" }, { value: "NON_BILLABLE", label: "Internal" }] },
              ]}
            />
          }
          empty={{ icon: <Briefcase />, title: "No projects yet", description: "Create a project for each client engagement or monthly retainer." }}
        />
      )}
      {!showFinance ? null : <p className="mt-3 text-xs text-muted">Profit = invoiced revenue (excl. GST) − project expenses − time cost (hours × cost rate). Overall total: {formatMoney(profit.reduce((a, p) => a + num(p.profit), 0))} for listed projects. <LinkButton href="/intelligence?tab=projects" variant="link" size="sm">Details</LinkButton></p>}
    </>
  );
}
