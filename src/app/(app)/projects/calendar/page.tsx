import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { param, type SearchParams } from "@/lib/list";
import { addDays, addMonths, endOfMonth, isoDate, monthLongLabel, startOfMonth, todayIST, toDateOnly } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar" };

type Ev = { key: string; date: string; label: string; href: string; tone: "task" | "milestone" | "project" | "invoice" | "renewal"; done?: boolean };

const TONES: Record<Ev["tone"], string> = {
  task: "bg-brand-soft text-brand",
  milestone: "bg-accent-soft text-accent",
  project: "bg-success-soft text-success",
  invoice: "bg-warning-soft text-warning",
  renewal: "bg-surface-2 text-muted border border-line",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("projects");
  const sp = await searchParams;
  let month = startOfMonth(todayIST());
  try {
    if (param(sp, "month")) month = startOfMonth(toDateOnly(`${param(sp, "month")}-01`));
  } catch {
    /* default */
  }
  const from = month;
  const to = endOfMonth(month);
  const mineOnly = param(sp, "mine") === "1" && user.employeeId;
  const [tasks, milestones, projects, invoices, subs] = await Promise.all([
    db.task.findMany({ where: { deletedAt: null, dueDate: { gte: from, lte: to }, project: { deletedAt: null }, ...(mineOnly ? { assigneeId: user.employeeId } : {}) }, select: { id: true, title: true, dueDate: true, status: true, projectId: true } }),
    db.milestone.findMany({ where: { dueDate: { gte: from, lte: to }, project: { deletedAt: null } }, select: { id: true, title: true, dueDate: true, status: true, projectId: true } }),
    db.project.findMany({ where: { deletedAt: null, endDate: { gte: from, lte: to } }, select: { id: true, name: true, endDate: true, status: true } }),
    can(user.access, "billing") ? db.invoice.findMany({ where: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { gte: from, lte: to } }, select: { id: true, number: true, dueDate: true, clientName: true } }) : Promise.resolve([]),
    can(user.access, "assets") ? db.subscription.findMany({ where: { deletedAt: null, status: "ACTIVE", renewalDate: { gte: from, lte: to } }, select: { id: true, name: true, renewalDate: true } }) : Promise.resolve([]),
  ]);
  const events: Ev[] = [
    ...tasks.map((t) => ({ key: `t${t.id}`, date: isoDate(t.dueDate), label: t.title, href: `/projects/${t.projectId}?tab=tasks#task-${t.id}`, tone: "task" as const, done: t.status === "DONE" })),
    ...milestones.map((m) => ({ key: `m${m.id}`, date: isoDate(m.dueDate), label: `◆ ${m.title}`, href: `/projects/${m.projectId}?tab=milestones`, tone: "milestone" as const, done: m.status === "DONE" })),
    ...projects.map((p) => ({ key: `p${p.id}`, date: isoDate(p.endDate), label: `End: ${p.name}`, href: `/projects/${p.id}`, tone: "project" as const, done: p.status === "COMPLETED" })),
    ...invoices.map((i) => ({ key: `i${i.id}`, date: isoDate(i.dueDate), label: `Due: ${i.number} · ${i.clientName}`, href: `/billing/invoices/${i.id}`, tone: "invoice" as const })),
    ...subs.map((s) => ({ key: `s${s.id}`, date: isoDate(s.renewalDate), label: `Renews: ${s.name}`, href: `/subscriptions?q=${encodeURIComponent(s.name)}`, tone: "renewal" as const })),
  ];
  // Monday-first grid
  const gridStart = addDays(from, -((from.getUTCDay() + 6) % 7));
  const days: Date[] = [];
  for (let d = gridStart; d <= to || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
  const today = isoDate(todayIST());
  const key = (d: Date) => isoDate(d).slice(0, 7);

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Task deadlines, milestones, project end dates, invoice due dates and renewals."
        actions={
          <div className="flex items-center gap-2">
            <LinkButton href={`/projects/calendar?month=${key(addMonths(month, -1))}${mineOnly ? "&mine=1" : ""}`} variant="outline" size="icon" aria-label="Previous month"><ChevronLeft /></LinkButton>
            <span className="min-w-[150px] text-center text-sm font-semibold">{monthLongLabel(month)}</span>
            <LinkButton href={`/projects/calendar?month=${key(addMonths(month, 1))}${mineOnly ? "&mine=1" : ""}`} variant="outline" size="icon" aria-label="Next month"><ChevronRight /></LinkButton>
            <LinkButton href="/projects/calendar" variant="ghost">Today</LinkButton>
            {user.employeeId ? <LinkButton href={`/projects/calendar?month=${key(month)}${mineOnly ? "" : "&mine=1"}`} variant={mineOnly ? "subtle" : "outline"}>My tasks</LinkButton> : null}
          </div>
        }
      />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-surface-2 text-center text-xs font-medium text-muted">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const iso = isoDate(d);
            const list = events.filter((e) => e.date === iso);
            const inMonth = d.getUTCMonth() === month.getUTCMonth();
            return (
              <div key={iso} className={cn("min-h-[110px] border-b border-r border-line p-1.5 text-xs", !inMonth && "bg-surface-2/50 text-subtle")}>
                <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[12px]", iso === today && "bg-brand font-semibold text-white")}>{d.getUTCDate()}</div>
                <div className="space-y-1">
                  {list.slice(0, 4).map((e) => (
                    <Link key={e.key} href={e.href} title={e.label} className={cn("block truncate rounded px-1.5 py-0.5 text-[11px]", TONES[e.tone], e.done && "line-through opacity-60")}>{e.label}</Link>
                  ))}
                  {list.length > 4 ? <p className="px-1.5 text-[11px] text-muted">+{list.length - 4} more</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        {(Object.keys(TONES) as Ev["tone"][]).map((t) => <span key={t} className="flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded", TONES[t])} />{t === "task" ? "Task" : t === "milestone" ? "Milestone" : t === "project" ? "Project end" : t === "invoice" ? "Invoice due" : "Renewal"}</span>)}
      </div>
    </>
  );
}
