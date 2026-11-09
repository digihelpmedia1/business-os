import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Pencil } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { D, Decimal, formatMoney } from "@/lib/money";
import { addMonths, fmtDate, fyOf, startOfMonth, todayIST } from "@/lib/dates";
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusBadge } from "@/components/status-badge";
import { SimpleTable } from "@/components/simple-table";
import { archiveEmployee, saveEmployee } from "@/server/actions/team";
import { employeeDefaults, employeeFields } from "../fields";

export default async function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess("team");
  const { id } = await params;
  const today = todayIST();
  const fy = fyOf(today);
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { email: true } },
      salaryRecords: { orderBy: { effectiveFrom: "desc" } },
      transactions: { where: { deletedAt: null, type: "EXPENSE" }, orderBy: { date: "desc" }, take: 24, include: { account: { select: { name: true } } } },
      leaves: { orderBy: { startDate: "desc" }, take: 20 },
      tasks: { where: { deletedAt: null, status: { not: "DONE" } }, include: { project: { select: { id: true, name: true } } }, orderBy: { dueDate: { sort: "asc", nulls: "last" } } },
      managedProjects: { where: { deletedAt: null }, select: { id: true, name: true, status: true } },
      assets: { where: { deletedAt: null } },
      timeEntries: { where: { date: { gte: startOfMonth(addMonths(today, -2)) } }, include: { project: { select: { name: true } } } },
      attendance: { where: { date: { gte: fy.from } } },
    },
  });
  if (!e) notFound();
  const showPay = can(user.access, "finance") || can(user.access, "team", "FULL");
  const users = await db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true } });
  const paidFy = e.transactions.filter((t) => t.date >= fy.from).reduce((a, t) => a.plus(D(t.amount)), new Decimal(0));
  const hours = e.timeEntries.reduce((a, t) => a.plus(D(t.hours)), new Decimal(0));
  const att = (s: string) => e.attendance.filter((a) => a.status === s).length;
  const leaveDays = e.leaves.filter((l) => l.status === "APPROVED" && l.startDate >= fy.from).reduce((a, l) => a + Number(l.days), 0);
  const byProject = new Map<string, number>();
  e.timeEntries.forEach((t) => byProject.set(t.project.name, (byProject.get(t.project.name) ?? 0) + Number(t.hours)));
  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/team" className="hover:text-fg">Employees & Freelancers</Link>}
        title={<span className="flex items-center gap-3">{e.name} <StatusBadge status={e.status} /><Badge tone={e.type === "FREELANCER" ? "accent" : "brand"}>{e.type === "FREELANCER" ? "Freelancer" : "Employee"}</Badge></span>}
        description={[e.designation, e.department].filter(Boolean).join(" · ") || undefined}
        actions={can(user.access, "team", "EDIT") && !e.deletedAt ? (
          <>
            <FormDialog trigger={<><Pencil /> Edit</>} triggerVariant="outline" title="Edit profile" fields={employeeFields(users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })))} defaults={employeeDefaults(e)} action={saveEmployee.bind(null, e.id)} size="lg" />
            {can(user.access, "team", "FULL") ? <ConfirmAction action={archiveEmployee.bind(null, e.id)} label={<><Archive /> Archive</>} title={`Archive ${e.name}?`} message="Open tasks are unassigned and assets returned to stock. Payment history is kept." confirmLabel="Archive" variant="danger-ghost" size="md" /> : null}
          </>
        ) : null}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open tasks" value={e.tasks.length} />
        <StatCard label="Hours (last 3 months)" value={hours.toFixed(1)} />
        <StatCard label={`Leave taken (${fy.label})`} value={`${leaveDays} day(s)`} />
        {showPay ? <StatCard label={`Paid in ${fy.label}`} value={formatMoney(paidFy)} href={`/finance/transactions?q=${encodeURIComponent(e.name)}`} /> : <StatCard label="Present days (FY)" value={att("PRESENT") + att("WORK_FROM_HOME")} />}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <DescriptionList className="sm:grid-cols-1" items={[
              { label: "Email", value: e.email }, { label: "Phone", value: e.phone }, { label: "Joined", value: fmtDate(e.joiningDate) },
              { label: "Exit date", value: e.exitDate ? fmtDate(e.exitDate) : null }, { label: "Login account", value: e.user?.email ?? "Not linked" },
              ...(showPay ? [
                { label: "Compensation", value: e.compensationType === "MONTHLY_SALARY" ? `${formatMoney(e.monthlySalary)} / month` : e.compensationType === "HOURLY" ? `${formatMoney(e.hourlyRate)} / hour` : "Per project" },
                { label: "Cost per hour", value: e.costPerHour ? formatMoney(e.costPerHour) : e.monthlySalary ? `${formatMoney(e.monthlySalary.dividedBy(176))} (derived)` : null },
                { label: "PAN", value: e.pan }, { label: "UPI", value: e.upiId }, { label: "Bank", value: e.bankAccount ? `····${e.bankAccount.slice(-4)} · ${e.bankIfsc ?? ""}` : null },
              ] : []),
              { label: "Attendance (FY)", value: `${att("PRESENT")} present · ${att("WORK_FROM_HOME")} WFH · ${att("HALF_DAY")} half · ${att("ABSENT")} absent · ${att("ON_LEAVE")} leave` },
              { label: "Notes", value: e.notes },
            ]} />
          </CardBody>
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Open tasks" />
            {e.tasks.length ? (
              <SimpleTable head={["Task", "Project", "Priority", "Due"]} rows={e.tasks.slice(0, 15).map((t) => [t.title, <Link key="p" href={`/projects/${t.project.id}?tab=tasks`} className="text-brand">{t.project.name}</Link>, <StatusBadge key="pr" status={t.priority} />, <span key="d" className={t.dueDate && t.dueDate < today ? "text-danger" : ""}>{fmtDate(t.dueDate)}</span>])} />
            ) : <EmptyState title="No open tasks" className="py-8" />}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Time by project (3 months)" />
              {byProject.size ? <SimpleTable head={["Project", "Hours"]} rows={[...byProject.entries()].sort((a, b) => b[1] - a[1]).map(([p, h]) => [p, h.toFixed(1)])} /> : <EmptyState title="No time logged" className="py-8" />}
            </Card>
            <Card>
              <CardHeader title="Projects managed & assets" />
              <ul className="divide-y divide-line text-[13px]">
                {e.managedProjects.map((p) => <li key={p.id} className="flex justify-between px-5 py-2.5"><Link href={`/projects/${p.id}`} className="text-brand">{p.name}</Link><StatusBadge status={p.status} /></li>)}
                {e.assets.map((a) => <li key={a.id} className="flex justify-between px-5 py-2.5"><Link href={`/assets/${a.id}`}>{a.name}</Link><span className="text-xs text-muted">{a.serialNumber}</span></li>)}
                {!e.managedProjects.length && !e.assets.length ? <li className="px-5 py-8 text-center text-muted">Nothing assigned.</li> : null}
              </ul>
            </Card>
          </div>
          {showPay ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Payment history" action={<Link href="/team/payroll" className="text-[13px] text-brand">Payroll</Link>} />
                {e.transactions.length ? <SimpleTable head={["Date", "Month", "Amount"]} rows={e.transactions.map((t) => [fmtDate(t.date), t.payrollMonth ?? "—", formatMoney(t.amount)])} /> : <EmptyState title="No payments recorded" className="py-8" />}
              </Card>
              <Card>
                <CardHeader title="Salary records" />
                {e.salaryRecords.length ? <SimpleTable head={["Effective from", "Note", "Monthly"]} rows={e.salaryRecords.map((s) => [fmtDate(s.effectiveFrom), s.notes ?? "", formatMoney(s.monthlySalary)])} /> : <EmptyState title="No salary records" className="py-8" />}
              </Card>
            </div>
          ) : null}
          <Card>
            <CardHeader title="Leave" action={<Link href="/team/leave" className="text-[13px] text-brand">Manage</Link>} />
            {e.leaves.length ? <SimpleTable head={["From", "To", "Type", "Status", "Days"]} rows={e.leaves.map((l) => [fmtDate(l.startDate), fmtDate(l.endDate), l.type.toLowerCase(), <StatusBadge key="s" status={l.status} />, String(l.days)])} /> : <EmptyState title="No leave records" className="py-8" />}
          </Card>
        </div>
      </div>
    </>
  );
}
