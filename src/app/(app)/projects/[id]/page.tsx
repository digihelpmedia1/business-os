import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Clock, FilePlus2, Pencil, Plus, ReceiptText, Repeat, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { param, withParams, type SearchParams } from "@/lib/list";
import { fmtDate, fmtDateTime, isoDate, todayIST } from "@/lib/dates";
import { D, Decimal, formatMoney } from "@/lib/money";
import { clientOptions, employeeOptions, serviceOptions } from "@/lib/options";
import { projectProfitability } from "@/lib/finance/reports";
import { Badge, Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, Progress, StatCard } from "@/components/ui/primitives";
import { LinkTabs } from "@/components/ui/data-table";
import { FormDialog, InlineForm, SubmitButton } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/fields";
import { StatusBadge } from "@/components/status-badge";
import { TaskBoard, type BoardTask } from "@/components/projects/task-board";
import { addProjectNote, archiveProject, deleteProjectItem, deleteProjectNote, deleteTask, deleteTimeEntry, rollOverRecurringTasks, saveDeliverable, saveMilestone, saveProject, saveTask, saveTimeEntry } from "@/server/actions/projects";
import { recurringFromProject } from "@/server/actions/billing";
import { projectDefaults, projectFields, taskDefaults, taskFields } from "../fields";

const TABS = ["overview", "tasks", "milestones", "time", "finance", "notes"] as const;

export default async function ProjectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("projects");
  const { id } = await params;
  const sp = await searchParams;
  const project = await db.project.findUnique({
    where: { id },
    include: {
      client: true,
      manager: true,
      service: true,
      tasks: { where: { deletedAt: null }, include: { assignee: { select: { name: true } } }, orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] },
      milestones: { orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }] },
      deliverables: { orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }] },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      timeEntries: { include: { employee: { select: { name: true } }, task: { select: { title: true } } }, orderBy: { date: "desc" }, take: 100 },
      recurringInvoices: { where: { isActive: true }, select: { id: true, name: true } },
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!project || project.deletedAt) notFound();
  const tab = (TABS as readonly string[]).includes(param(sp, "tab") ?? "") ? param(sp, "tab")! : "overview";
  const canEdit = can(user.access, "projects", "EDIT");
  const canFull = can(user.access, "projects", "FULL");
  const showFinance = can(user.access, "finance") || can(user.access, "intelligence");
  const [clients, employees, services] = await Promise.all([clientOptions(), employeeOptions(), serviceOptions()]);
  const today = todayIST();
  const top = project.tasks.filter((t) => !t.parentId);
  const done = top.filter((t) => t.status === "DONE").length;
  const progress = top.length ? done / top.length : 0;
  const hours = project.timeEntries.reduce((a, t) => a.plus(D(t.hours)), new Decimal(0));
  const [profit] = showFinance ? await projectProfitability(undefined, [project.id]) : [];
  const parents = top.map((t) => ({ value: t.id, label: t.title }));

  const board: BoardTask[] = top.map((t) => {
    const subs = project.tasks.filter((s) => s.parentId === t.id);
    return {
      id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate ? isoDate(t.dueDate) : null, assignee: t.assignee?.name ?? null,
      project: { id: project.id, name: project.name }, subtasks: subs.length, subtasksDone: subs.filter((s) => s.status === "DONE").length, isRecurring: t.isRecurring,
      canMove: canEdit || (!!user.employeeId && t.assigneeId === user.employeeId),
    };
  });

  const itemFields = (withAmount: boolean) => [
    { name: "title", label: "Title", required: true, span: 2 as const },
    { name: "dueDate", label: "Due date", type: "date" as const },
    { name: "status", label: "Status", type: "select" as const, emptyOption: false as const, options: [{ value: "PENDING", label: "Pending" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "DONE", label: "Done" }] },
    ...(withAmount ? [{ name: "amount", label: "Billing amount (₹)", type: "money" as const, hint: "Optional — invoice on completion" }] : []),
  ];
  const timeFields = [
    ...(canEdit ? [{ name: "employeeId", label: "Team member", type: "select" as const, options: employees, required: true }] : []),
    { name: "projectId", label: "", type: "hidden" as const },
    { name: "taskId", label: "Task", type: "select" as const, options: parents },
    { name: "date", label: "Date", type: "date" as const, required: true },
    { name: "hours", label: "Hours", type: "number" as const, step: "0.25", required: true },
    { name: "billable", label: "Billable", type: "checkbox" as const },
    { name: "description", label: "What was done", type: "textarea" as const },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/projects" className="hover:text-fg">Projects</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{project.name} <StatusBadge status={project.status} />{project.billingType === "RETAINER" ? <Badge tone="accent">Retainer</Badge> : null}</span>}
        description={[project.client?.name ?? "Internal project", project.service?.name, project.code].filter(Boolean).join(" · ")}
        actions={
          <>
            {canEdit ? (
              <>
                <FormDialog trigger={<><Clock /> Log time</>} triggerVariant="outline" title="Log time" fields={timeFields} defaults={{ projectId: project.id, date: isoDate(today), billable: true, employeeId: user.employeeId }} action={saveTimeEntry.bind(null, null)} />
                <FormDialog trigger={<><Pencil /> Edit</>} triggerVariant="outline" title="Edit project" fields={projectFields({ clients, services, employees })} defaults={projectDefaults(project)} action={saveProject.bind(null, project.id)} size="lg" />
                <FormDialog trigger={<><Plus /> Task</>} title="New task" fields={taskFields({ employees, parents })} defaults={{ projectId: project.id, status: "TODO", priority: "MEDIUM" }} action={saveTask.bind(null, null)} size="lg" />
              </>
            ) : user.employeeId ? (
              <FormDialog trigger={<><Clock /> Log my time</>} triggerVariant="outline" title="Log time" fields={timeFields} defaults={{ projectId: project.id, date: isoDate(today), billable: true }} action={saveTimeEntry.bind(null, null)} />
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Progress" value={`${Math.round(progress * 100)}%`} hint={`${done} of ${top.length} tasks done`} />
        <StatCard label="Hours logged" value={hours.toFixed(1)} hint="Last 100 entries" />
        {showFinance && profit ? (
          <>
            <StatCard label="Revenue (excl. GST)" value={formatMoney(profit.revenue)} hint="Invoiced to this project" />
            <StatCard label="Profit" value={formatMoney(profit.profit)} tone={profit.profit.lt(0) ? "danger" : "success"} hint={profit.margin !== null ? `${(profit.margin * 100).toFixed(1)}% margin` : "No revenue yet"} />
          </>
        ) : (
          <>
            <StatCard label="Milestones" value={`${project.milestones.filter((m) => m.status === "DONE").length}/${project.milestones.length}`} />
            <StatCard label="End date" value={fmtDate(project.endDate)} />
          </>
        )}
      </div>
      <LinkTabs
        active={tab}
        tabs={[
          { key: "overview", label: "Overview", href: withParams(`/projects/${id}`, sp, { tab: null }) },
          { key: "tasks", label: "Tasks", href: withParams(`/projects/${id}`, sp, { tab: "tasks" }), count: top.length },
          { key: "milestones", label: "Milestones & deliverables", href: withParams(`/projects/${id}`, sp, { tab: "milestones" }) },
          { key: "time", label: "Time", href: withParams(`/projects/${id}`, sp, { tab: "time" }) },
          ...(showFinance ? [{ key: "finance", label: "Finance", href: withParams(`/projects/${id}`, sp, { tab: "finance" }) }] : []),
          { key: "notes", label: "Notes & files", href: withParams(`/projects/${id}`, sp, { tab: "notes" }), count: project.notes.length },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Client", value: project.client ? <Link href={`/billing/clients/${project.client.id}`} className="text-brand">{project.client.name}</Link> : "Internal" },
                  { label: "Project manager", value: project.manager?.name },
                  { label: "Service", value: project.service?.name },
                  { label: "Billing", value: project.billingType.replace("_", " ").toLowerCase() + (project.monthlyFee ? ` · ${formatMoney(project.monthlyFee)}/month` : "") },
                  { label: "Budget", value: project.budget ? formatMoney(project.budget) : null },
                  { label: "Timeline", value: `${fmtDate(project.startDate)} → ${fmtDate(project.endDate)}` },
                  { label: "Completed", value: project.completedAt ? fmtDateTime(project.completedAt) : null },
                  { label: "Recurring invoice", value: project.recurringInvoices[0] ? <Link href={`/billing/recurring/${project.recurringInvoices[0].id}`} className="text-brand">{project.recurringInvoices[0].name}</Link> : null },
                ]}
              />
              {project.description ? <p className="mt-5 whitespace-pre-wrap border-t border-line pt-4 text-sm">{project.description}</p> : null}
            </CardBody>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Next up" />
              <ul className="divide-y divide-line">
                {top.filter((t) => t.status !== "DONE").slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
                    <span className="truncate">{t.title}</span>
                    <span className={t.dueDate && t.dueDate < today ? "text-danger" : "text-muted"}>{fmtDate(t.dueDate)}</span>
                  </li>
                ))}
                {!top.some((t) => t.status !== "DONE") ? <li className="px-5 py-6 text-center text-[13px] text-muted">No open tasks.</li> : null}
              </ul>
            </Card>
            {canEdit ? (
              <Card>
                <CardHeader title="Actions" />
                <CardBody className="flex flex-col gap-2">
                  {can(user.access, "billing", "EDIT") && project.clientId ? <LinkButton href={`/billing/invoices/new?projectId=${project.id}`} variant="outline" size="sm"><ReceiptText /> Invoice this project</LinkButton> : null}
                  {can(user.access, "billing", "EDIT") && project.clientId ? <LinkButton href={`/billing/quotes/new?clientId=${project.clientId}`} variant="outline" size="sm"><FilePlus2 /> New quotation</LinkButton> : null}
                  {project.billingType === "RETAINER" && can(user.access, "billing", "EDIT") && !project.recurringInvoices.length ? (
                    <ConfirmAction action={recurringFromProject.bind(null, project.id)} label={<><Repeat /> Set up monthly invoice</>} title="Create a monthly recurring invoice?" message={`Invoices of ${formatMoney(project.monthlyFee)} will be generated each month for ${project.client?.name}.`} confirmVariant="primary" confirmLabel="Create" variant="outline" />
                  ) : null}
                  <ConfirmAction action={rollOverRecurringTasks.bind(null, project.id)} label={<><Repeat /> Roll over monthly tasks</>} title="Create next month's recurring tasks?" message="Tasks marked “repeats monthly” are copied with dates moved one month ahead." confirmVariant="primary" confirmLabel="Roll over" variant="outline" />
                  {canFull ? <ConfirmAction action={archiveProject.bind(null, project.id)} label={<><Archive /> Archive project</>} title="Archive this project?" message="It will be hidden from lists. Financial records are kept." confirmLabel="Archive" variant="danger-ghost" /> : null}
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div className="space-y-4">
          <TaskBoard tasks={board} today={isoDate(today)} showProject={false} />
          <Card>
            <CardHeader title="All tasks & subtasks" />
            {top.length ? (
              <ul className="divide-y divide-line">
                {top.map((t) => (
                  <li key={t.id} id={`task-${t.id}`} className="px-5 py-3">
                    <TaskRow t={t} canEdit={canEdit} canFull={canFull} employees={employees} parents={parents} today={today} />
                    {project.tasks.filter((s) => s.parentId === t.id).map((s) => (
                      <div key={s.id} className="ml-6 mt-2 border-l border-line pl-4"><TaskRow t={s} canEdit={canEdit} canFull={canFull} employees={employees} parents={parents} today={today} /></div>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No tasks yet" description="Break the project into tasks and assign them to your team." />
            )}
          </Card>
        </div>
      ) : null}

      {tab === "milestones" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["milestone", "deliverable"] as const).map((kind) => {
            const items = kind === "milestone" ? project.milestones : project.deliverables;
            const action = kind === "milestone" ? saveMilestone : saveDeliverable;
            return (
              <Card key={kind}>
                <CardHeader
                  title={kind === "milestone" ? "Milestones" : "Deliverables"}
                  action={canEdit ? <FormDialog trigger={<><Plus /> Add</>} triggerSize="sm" triggerVariant="outline" title={`New ${kind}`} fields={itemFields(kind === "milestone")} defaults={{ status: "PENDING" }} action={action.bind(null, project.id, null)} /> : null}
                />
                {items.length ? (
                  <ul className="divide-y divide-line">
                    {items.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                        <div className="min-w-0 flex-1">
                          <p className={m.status === "DONE" ? "text-muted line-through" : "font-medium"}>{m.title}</p>
                          <p className="text-xs text-muted">Due {fmtDate(m.dueDate)}{"amount" in m && m.amount ? ` · ${formatMoney(m.amount)}` : ""}</p>
                        </div>
                        <StatusBadge status={m.status} />
                        {canEdit ? <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title={`Edit ${kind}`} fields={itemFields(kind === "milestone")} defaults={{ title: m.title, dueDate: isoDate(m.dueDate), status: m.status, amount: "amount" in m && m.amount ? (m.amount as Decimal).toFixed(2) : undefined }} action={action.bind(null, project.id, m.id)} /> : null}
                        {canFull ? <ConfirmAction action={deleteProjectItem.bind(null, kind, m.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title={`Delete ${kind}?`} confirmLabel="Delete" /> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={`No ${kind}s yet`} className="py-8" />
                )}
              </Card>
            );
          })}
        </div>
      ) : null}

      {tab === "time" ? (
        <Card>
          <CardHeader title="Time entries" description={`${hours.toFixed(2)} hours${showFinance && profit ? ` · time cost ${formatMoney(profit.timeCost)}` : ""}`} />
          {project.timeEntries.length ? (
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2">Date</th><th className="px-4 py-2">Member</th><th className="px-4 py-2">Task / description</th><th className="px-4 py-2 text-right">Hours</th>{showFinance ? <th className="px-4 py-2 text-right">Cost</th> : null}<th className="px-4 py-2" /></tr></thead>
                <tbody>
                  {project.timeEntries.map((t) => (
                    <tr key={t.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">{fmtDate(t.date)}</td>
                      <td className="px-4 py-2.5">{t.employee.name}</td>
                      <td className="px-4 py-2.5"><span className="block">{t.task?.title ?? "General"}</span>{t.description ? <span className="text-xs text-muted">{t.description}</span> : null}{!t.billable ? <Badge className="ml-1">Non-billable</Badge> : null}</td>
                      <td className="tabular px-4 py-2.5 text-right">{t.hours.toFixed(2)}</td>
                      {showFinance ? <td className="tabular px-4 py-2.5 text-right">{formatMoney(t.hours.times(t.costRate))}</td> : null}
                      <td className="px-4 py-2.5 text-right">{canFull || t.employeeId === user.employeeId ? <ConfirmAction action={deleteTimeEntry.bind(null, t.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete time entry?" confirmLabel="Delete" /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Clock />} title="No time logged" description="Log time to track effort and true project profitability." />
          )}
        </Card>
      ) : null}

      {tab === "finance" && showFinance && profit ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Profitability (all time)" />
            <CardBody className="space-y-2 text-sm">
              <FinRow label="Revenue (invoiced, excl. GST)" value={formatMoney(profit.revenue)} />
              <FinRow label="Direct expenses & vendor bills" value={`− ${formatMoney(profit.directExpenses)}`} />
              <FinRow label={`Time cost (${profit.hours.toFixed(1)} h)`} value={`− ${formatMoney(profit.timeCost)}`} />
              <FinRow label="Profit" value={formatMoney(profit.profit)} bold />
              <FinRow label="Margin" value={profit.margin === null ? "Insufficient Data" : `${(profit.margin * 100).toFixed(1)}%`} />
              {project.budget ? (
                <div className="pt-3">
                  <p className="mb-1 text-xs text-muted">Budget used: {formatMoney(profit.totalCost)} of {formatMoney(project.budget)}</p>
                  <Progress value={profit.budgetUsed ?? 0} tone={(profit.budgetUsed ?? 0) > 1 ? "danger" : (profit.budgetUsed ?? 0) > 0.8 ? "warning" : "brand"} />
                </div>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Linked records" />
            <CardBody className="flex flex-wrap gap-2">
              <LinkButton href={`/billing/invoices?q=&projectId=${project.id}`} variant="outline" size="sm">Invoices</LinkButton>
              <LinkButton href={`/finance/transactions?projectId=${project.id}`} variant="outline" size="sm">Expenses & income</LinkButton>
              <LinkButton href={`/vendors/bills?projectId=${project.id}`} variant="outline" size="sm">Vendor bills</LinkButton>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Internal notes" />
            <CardBody>
              <InlineForm action={addProjectNote.bind(null, project.id)} resetOnSuccess successMessage="Note added">
                <div className="space-y-2">
                    <Textarea name="body" placeholder="Add a note for the team…" rows={3} />
                    <div className="flex justify-end"><SubmitButton>Add note</SubmitButton></div>
                  </div>
              </InlineForm>
              <ul className="mt-4 space-y-3">
                {project.notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-line p-3 text-[13px]">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span>{n.author.name} · {fmtDateTime(n.createdAt)}</span>
                      {n.authorId === user.id || canFull ? <ConfirmAction action={deleteProjectNote.bind(null, n.id)} label="Delete" variant="ghost" size="sm" title="Delete note?" confirmLabel="Delete" /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Attachments" action={can(user.access, "vault", "EDIT") ? <LinkButton href={`/vault?projectId=${project.id}&upload=1`} variant="outline" size="sm"><Plus /> Upload</LinkButton> : null} />
            {project.documents.length ? (
              <ul className="divide-y divide-line">
                {project.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between px-5 py-2.5 text-[13px]">
                    <a href={`/api/files/${d.fileId}`} target="_blank" className="text-brand">{d.title}</a>
                    <span className="text-xs text-muted">{fmtDate(isoDate(d.createdAt))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No files attached" description="Upload briefs, creatives and reports to the Document Vault and link them to this project." className="py-8" />
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}

function TaskRow({ t, canEdit, canFull, employees, parents, today }: {
  t: { id: string; title: string; status: string; priority: string; dueDate: Date | null; assignee: { name: string } | null; isRecurring: boolean; projectId: string; parentId: string | null; assigneeId: string | null; startDate: Date | null; estimateHours: Decimal | null; description: string | null } & Parameters<typeof taskDefaults>[0];
  canEdit: boolean; canFull: boolean; employees: { value: string; label: string }[]; parents: { value: string; label: string }[]; today: Date;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className={`min-w-0 flex-1 ${t.status === "DONE" ? "text-muted line-through" : "font-medium"}`}>{t.title}</span>
      <StatusBadge status={t.status} />
      <StatusBadge status={t.priority} />
      <span className="w-28 truncate text-xs text-muted">{t.assignee?.name ?? "Unassigned"}</span>
      <span className={`w-24 text-xs ${t.dueDate && t.dueDate < today && t.status !== "DONE" ? "text-danger" : "text-muted"}`}>{fmtDate(t.dueDate)}</span>
      {canEdit ? <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit task" fields={taskFields({ employees, parents: parents.filter((p) => p.value !== t.id) })} defaults={taskDefaults(t)} action={saveTask.bind(null, t.id)} size="lg" /> : null}
      {canFull ? <ConfirmAction action={deleteTask.bind(null, t.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete task?" message="Subtasks are deleted too." confirmLabel="Delete" /> : null}
    </div>
  );
}

function FinRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "border-t border-line pt-2 font-semibold" : ""}`}>
      <span className={bold ? "" : "text-muted"}>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
