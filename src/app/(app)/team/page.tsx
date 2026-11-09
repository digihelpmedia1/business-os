import { Plus, Users, Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams, orderByField } from "@/lib/list";
import { D, Decimal, formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { saveEmployee } from "@/server/actions/team";
import { employeeDefaults, employeeFields } from "./fields";

export const metadata = { title: "Employees & Freelancers" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("team");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["name", "joiningDate"] as const, defaultSort: "name", defaultDir: "asc", pageSize: 50 });
  const status = param(sp, "status") ?? "CURRENT";
  const where: Prisma.EmployeeWhereInput = {
    deletedAt: null,
    ...(param(sp, "type") ? { type: param(sp, "type") as "EMPLOYEE" } : {}),
    ...(status === "CURRENT" ? { status: { not: "EXITED" } } : status !== "ALL" ? { status: status as "ACTIVE" } : {}),
    ...(param(sp, "department") ? { department: param(sp, "department") } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" } }, { email: { contains: list.q, mode: "insensitive" } }, { designation: { contains: list.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, users, depts, current] = await Promise.all([
    db.employee.findMany({ where, include: { user: { select: { email: true } }, _count: { select: { tasks: { where: { deletedAt: null, status: { not: "DONE" } } }, managedProjects: { where: { deletedAt: null, status: "IN_PROGRESS" } } } } }, orderBy: [orderByField(list.sort, list.dir, ["joiningDate"])], skip: list.skip, take: list.pageSize }),
    db.employee.count({ where }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true } }),
    db.employee.findMany({ where: { deletedAt: null, department: { not: null } }, distinct: ["department"], select: { department: true } }),
    db.employee.findMany({ where: { deletedAt: null, status: { not: "EXITED" } }, select: { type: true, monthlySalary: true, compensationType: true } }),
  ]);
  const payroll = current.filter((e) => e.type === "EMPLOYEE" && e.compensationType === "MONTHLY_SALARY").reduce((a, e) => a.plus(D(e.monthlySalary)), new Decimal(0));
  const showPay = can(user.access, "finance") || can(user.access, "team", "FULL");
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "name", header: "Name", sortKey: "name", render: (e) => <span><span className="block">{e.name}</span><span className="text-xs text-muted">{[e.designation, e.department].filter(Boolean).join(" · ") || "—"}</span></span> },
    { key: "type", header: "Type", render: (e) => <Badge tone={e.type === "FREELANCER" ? "accent" : "brand"}>{e.type === "FREELANCER" ? "Freelancer" : "Employee"}</Badge> },
    { key: "joined", header: "Joined", sortKey: "joiningDate", render: (e) => fmtDate(e.joiningDate) },
    { key: "work", header: "Workload", render: (e) => <span className="text-[13px]">{e._count.tasks} open task(s)<span className="block text-xs text-muted">{e._count.managedProjects} active project(s) managed</span></span> },
    { key: "login", header: "Login", render: (e) => (e.user ? <span className="text-xs">{e.user.email}</span> : <span className="text-xs text-muted">Not linked</span>) },
    { key: "status", header: "Status", render: (e) => <StatusBadge status={e.status} /> },
    ...(showPay ? [{ key: "pay", header: "Compensation", align: "right" as const, render: (e: Row) => (e.compensationType === "MONTHLY_SALARY" ? `${formatMoney(e.monthlySalary)}/mo` : e.compensationType === "HOURLY" ? `${formatMoney(e.hourlyRate)}/h` : "Per project") }] : []),
  ];
  return (
    <>
      <PageHeader
        title="Employees & Freelancers"
        description="Profiles, workload, attendance, leave and payments for your team."
        actions={
          <>
            <LinkButton href="/api/export/employees" variant="outline"><Download /> CSV</LinkButton>
            {can(user.access, "team", "EDIT") ? <FormDialog trigger={<><Plus /> Add person</>} title="Add employee or freelancer" fields={employeeFields(users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })))} defaults={employeeDefaults()} action={saveEmployee.bind(null, null)} size="lg" /> : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Employees" value={current.filter((e) => e.type === "EMPLOYEE").length} />
        <StatCard label="Freelancers" value={current.filter((e) => e.type === "FREELANCER").length} />
        {showPay ? <StatCard label="Monthly salary payroll" value={formatMoney(payroll)} hint="Active salaried employees" href="/team/payroll" /> : null}
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/team"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        rowHref={(e) => `/team/${e.id}`}
        toolbar={
          <ListToolbar
            placeholder="Search name, email, role…"
            filters={[
              { type: "select", name: "type", label: "Type", options: [{ value: "EMPLOYEE", label: "Employees" }, { value: "FREELANCER", label: "Freelancers" }] },
              { type: "select", name: "status", label: "Status", options: [{ value: "ALL", label: "All (incl. exited)" }, { value: "ACTIVE", label: "Active" }, { value: "ON_LEAVE", label: "On leave" }, { value: "EXITED", label: "Exited" }] },
              { type: "select", name: "department", label: "Department", options: depts.map((d) => ({ value: d.department!, label: d.department! })) },
            ]}
          />
        }
        empty={{ icon: <Users />, title: "No team members yet", description: "Add employees and freelancers to assign tasks, track time and record payments." }}
      />
    </>
  );
}
