import Link from "next/link";
import { CalendarClock, Clock, Plane } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { addDays, fmtDate, isoDate, startOfMonth, todayIST } from "@/lib/dates";
import { D, Decimal } from "@/lib/money";
import { Card, CardHeader, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { TaskBoard, type BoardTask } from "@/components/projects/task-board";
import { saveTimeEntry } from "@/server/actions/projects";
import { applyLeave } from "@/server/actions/team";

export const metadata = { title: "My Work" };

export default async function MyWorkPage() {
  const user = await requireUser();
  const today = todayIST();
  if (!user.employeeId) {
    return (
      <>
        <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} description={`Signed in as ${user.roleName}.`} />
        <Card><EmptyState icon={<CalendarClock />} title="Your account isn't linked to an employee profile" description="Ask an administrator to link your user to your employee profile (Users & Access → Users) to see your tasks, log time and request leave." /></Card>
      </>
    );
  }
  const [tasks, time, leaves, projects] = await Promise.all([
    db.task.findMany({ where: { deletedAt: null, assigneeId: user.employeeId, NOT: { status: "DONE", completedAt: { lt: addDays(today, -14) } } }, include: { project: { select: { id: true, name: true } }, subtasks: { where: { deletedAt: null }, select: { status: true } } }, orderBy: { dueDate: { sort: "asc", nulls: "last" } } }),
    db.timeEntry.findMany({ where: { employeeId: user.employeeId, date: { gte: startOfMonth(today) } }, include: { project: { select: { name: true } } }, orderBy: { date: "desc" } }),
    db.leaveRecord.findMany({ where: { employeeId: user.employeeId }, orderBy: { startDate: "desc" }, take: 6 }),
    db.project.findMany({ where: { deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] }, OR: [{ tasks: { some: { assigneeId: user.employeeId } } }, { managerId: user.employeeId }] }, select: { id: true, name: true } }),
  ]);
  const board: BoardTask[] = tasks.filter((t) => !t.parentId || true).map((t) => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate ? isoDate(t.dueDate) : null, assignee: user.name, project: t.project,
    subtasks: t.subtasks.length, subtasksDone: t.subtasks.filter((s) => s.status === "DONE").length, isRecurring: t.isRecurring, canMove: true,
  }));
  const hours = time.reduce((a, t) => a.plus(D(t.hours)), new Decimal(0));
  const overdue = tasks.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate < today).length;
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
  return (
    <>
      <PageHeader
        title={`Hello, ${user.name.split(" ")[0]}`}
        description="Your tasks, time and leave in one place."
        actions={
          <>
            <FormDialog trigger={<><Plane /> Request leave</>} triggerVariant="outline" title="Request leave" fields={[
              { name: "type", label: "Leave type", type: "select", emptyOption: false, options: [{ value: "CASUAL", label: "Casual" }, { value: "SICK", label: "Sick" }, { value: "EARNED", label: "Earned" }, { value: "UNPAID", label: "Unpaid" }, { value: "OTHER", label: "Other" }] },
              { name: "startDate", label: "From", type: "date", required: true }, { name: "endDate", label: "To", type: "date", required: true },
              { name: "halfDay", label: "Half day", type: "checkbox" }, { name: "reason", label: "Reason", type: "textarea" },
            ]} defaults={{ type: "CASUAL", startDate: isoDate(today), endDate: isoDate(today) }} action={applyLeave} />
            {can(user.access, "projects") ? (
              <FormDialog trigger={<><Clock /> Log time</>} title="Log time" fields={[
                { name: "projectId", label: "Project", type: "select", options: projectOptions, required: true },
                { name: "taskId", label: "Task", type: "select", options: tasks.filter((t) => t.status !== "DONE").map((t) => ({ value: t.id, label: `${t.title} — ${t.project.name}` })) },
                { name: "date", label: "Date", type: "date", required: true }, { name: "hours", label: "Hours", type: "number", step: "0.25", required: true },
                { name: "billable", label: "Billable", type: "checkbox" }, { name: "description", label: "What did you work on?", type: "textarea" },
              ]} defaults={{ date: isoDate(today), billable: true }} action={saveTimeEntry.bind(null, null)} />
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open tasks" value={tasks.filter((t) => t.status !== "DONE").length} />
        <StatCard label="Overdue" value={overdue} tone={overdue ? "danger" : "default"} />
        <StatCard label="Due this week" value={tasks.filter((t) => t.status !== "DONE" && t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 7)).length} />
        <StatCard label="Hours this month" value={hours.toFixed(1)} />
      </div>
      {board.length ? <TaskBoard tasks={board} today={isoDate(today)} /> : <Card><EmptyState title="No tasks assigned to you" /></Card>}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="My time this month" />
          <ul className="divide-y divide-line">
            {time.length ? time.slice(0, 12).map((t) => <li key={t.id} className="flex justify-between px-5 py-2.5 text-[13px]"><span>{fmtDate(t.date)} · {t.project.name}{t.description ? <span className="text-muted"> — {t.description}</span> : null}</span><span className="tabular font-medium">{t.hours.toFixed(2)} h</span></li>) : <li className="px-5 py-6 text-center text-[13px] text-muted">No time logged this month.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="My leave" />
          <ul className="divide-y divide-line">
            {leaves.length ? leaves.map((l) => <li key={l.id} className="flex items-center justify-between px-5 py-2.5 text-[13px]"><span>{fmtDate(l.startDate)}{l.endDate > l.startDate ? ` – ${fmtDate(l.endDate)}` : ""} · {l.type.toLowerCase()} · {String(l.days)} day(s)</span><StatusBadge status={l.status} /></li>) : <li className="px-5 py-6 text-center text-[13px] text-muted">No leave records.</li>}
          </ul>
          {can(user.access, "team") ? <div className="border-t border-line px-5 py-2.5 text-[13px]"><Link href="/team/leave" className="text-brand">All leave requests</Link></div> : null}
        </Card>
      </div>
    </>
  );
}
