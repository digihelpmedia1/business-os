import { Clock, Download, Plus, Trash2 } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, withParams, type SearchParams } from "@/lib/list";
import { fmtDate, isoDate, todayIST, toDateOnly } from "@/lib/dates";
import { D, Decimal, formatMoney } from "@/lib/money";
import { employeeOptions, projectOptions } from "@/lib/options";
import { PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";
import { deleteTimeEntry, saveTimeEntry } from "@/server/actions/projects";

export const metadata = { title: "Time Tracking" };

export default async function TimePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("projects");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["date", "hours"] as const, defaultSort: "date", pageSize: 30 });
  const canEdit = can(user.access, "projects", "EDIT");
  const showCost = can(user.access, "finance") || can(user.access, "team");
  const employeeId = canEdit ? param(sp, "employeeId") : (user.employeeId ?? "__none__");
  const projectId = param(sp, "projectId");
  let date: Prisma.DateTimeFilter | undefined;
  try {
    if (param(sp, "from") || param(sp, "to")) date = { ...(param(sp, "from") ? { gte: toDateOnly(param(sp, "from")!) } : {}), ...(param(sp, "to") ? { lte: toDateOnly(param(sp, "to")!) } : {}) };
  } catch {
    date = undefined;
  }
  const where: Prisma.TimeEntryWhereInput = {
    ...(employeeId ? { employeeId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(param(sp, "billable") ? { billable: param(sp, "billable") === "1" } : {}),
    ...(date ? { date } : {}),
    ...(list.q ? { OR: [{ description: { contains: list.q, mode: "insensitive" } }, { task: { title: { contains: list.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, agg, all, projects, employees] = await Promise.all([
    db.timeEntry.findMany({ where, include: { employee: { select: { name: true } }, project: { select: { id: true, name: true } }, task: { select: { title: true } } }, orderBy: [{ [list.sort]: list.dir }, { createdAt: "desc" }], skip: list.skip, take: list.pageSize }),
    db.timeEntry.count({ where }),
    db.timeEntry.aggregate({ where, _sum: { hours: true } }),
    db.timeEntry.findMany({ where, select: { hours: true, costRate: true, billable: true } }),
    projectOptions({ activeOnly: true }),
    employeeOptions(),
  ]);
  const cost = all.reduce((a, t) => a.plus(D(t.hours).times(D(t.costRate))), new Decimal(0));
  const billable = all.filter((t) => t.billable).reduce((a, t) => a.plus(D(t.hours)), new Decimal(0));
  const tasks = await db.task.findMany({ where: { deletedAt: null, status: { not: "DONE" }, project: { deletedAt: null } }, select: { id: true, title: true, project: { select: { name: true } } }, orderBy: { title: "asc" }, take: 300 });

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", sortKey: "date", render: (t) => fmtDate(t.date) },
    { key: "emp", header: "Member", render: (t) => t.employee.name },
    { key: "project", header: "Project / task", render: (t) => <span><a href={`/projects/${t.project.id}?tab=time`} className="block text-brand">{t.project.name}</a><span className="text-xs text-muted">{t.task?.title ?? "General"}{t.description ? ` — ${t.description}` : ""}</span></span> },
    { key: "billable", header: "", render: (t) => (t.billable ? <Badge tone="success">Billable</Badge> : <Badge>Internal</Badge>) },
    { key: "hours", header: "Hours", sortKey: "hours", align: "right", render: (t) => t.hours.toFixed(2) },
    ...(showCost ? [{ key: "cost", header: "Cost", align: "right" as const, render: (t: Row) => formatMoney(t.hours.times(t.costRate)) }] : []),
    { key: "a", header: "", align: "right", render: (t) => (can(user.access, "projects", "FULL") || t.employeeId === user.employeeId ? <ConfirmAction action={deleteTimeEntry.bind(null, t.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete time entry?" confirmLabel="Delete" /> : null) },
  ];
  const fields = [
    ...(canEdit ? [{ name: "employeeId", label: "Team member", type: "select" as const, options: employees, required: true }] : []),
    { name: "projectId", label: "Project", type: "select" as const, options: projects, required: true },
    { name: "taskId", label: "Task (optional)", type: "select" as const, options: tasks.map((t) => ({ value: t.id, label: `${t.title} — ${t.project.name}` })) },
    { name: "date", label: "Date", type: "date" as const, required: true },
    { name: "hours", label: "Hours", type: "number" as const, step: "0.25", required: true },
    { name: "billable", label: "Billable", type: "checkbox" as const },
    { name: "description", label: "What was done", type: "textarea" as const },
  ];
  return (
    <>
      <PageHeader
        title="Time Tracking"
        description={canEdit ? "Team time across projects. Cost uses each person's cost per hour (or salary ÷ 176 hours)." : "Your logged time."}
        actions={
          <>
            <LinkButton href={withParams("/api/export/time", sp, { range: "custom", from: param(sp, "from") ?? "2000-01-01", to: param(sp, "to") ?? isoDate(todayIST()) })} variant="outline"><Download /> CSV</LinkButton>
            {canEdit || user.employeeId ? <FormDialog trigger={<><Plus /> Log time</>} title="Log time" fields={fields} defaults={{ date: isoDate(todayIST()), billable: true, employeeId: user.employeeId }} action={saveTimeEntry.bind(null, null)} /> : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total hours" value={D(agg._sum.hours).toFixed(1)} hint="Matching filters" />
        <StatCard label="Billable hours" value={billable.toFixed(1)} hint={D(agg._sum.hours).gt(0) ? `${billable.dividedBy(D(agg._sum.hours)).times(100).toFixed(0)}% utilisation` : undefined} />
        {showCost ? <StatCard label="Time cost" value={formatMoney(cost)} /> : null}
        <StatCard label="Entries" value={total} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/projects/time"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={
          <ListToolbar
            placeholder="Search description or task…"
            filters={[
              ...(canEdit ? [{ type: "select" as const, name: "employeeId", label: "Member", options: employees }] : []),
              { type: "select", name: "projectId", label: "Project", options: projects },
              { type: "select", name: "billable", label: "Billable", options: [{ value: "1", label: "Billable" }, { value: "0", label: "Internal" }] },
              { type: "date", name: "from", label: "From" },
              { type: "date", name: "to", label: "To" },
            ]}
          />
        }
        empty={{ icon: <Clock />, title: "No time entries", description: user.employeeId || canEdit ? "Log time against projects and tasks." : "Your user account isn't linked to an employee profile yet — ask an admin." }}
      />
    </>
  );
}
