import Link from "next/link";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { param, type SearchParams } from "@/lib/list";
import { D, Decimal, formatMoney } from "@/lib/money";
import { addMonths, fmtDate, isoDate, monthKey, monthLongLabel, startOfMonth, todayIST, toDateOnly, endOfMonth } from "@/lib/dates";
import { accountOptions, PAYMENT_METHOD_OPTIONS, projectOptions } from "@/lib/options";
import { Card, CardHeader, EmptyState, PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { LinkButton } from "@/components/ui/button";
import { recordPayout } from "@/server/actions/team";

export const metadata = { title: "Payroll & Payouts" };

export default async function PayrollPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("team");
  if (!can(user.access, "finance") && !can(user.access, "team", "FULL")) {
    return <Card className="mt-6"><EmptyState title="Payroll needs finance access" description="Ask an administrator for View access to Finance or Full access to Team." /></Card>;
  }
  const sp = await searchParams;
  let month = startOfMonth(todayIST());
  try {
    if (param(sp, "month")) month = toDateOnly(`${param(sp, "month")}-01`);
  } catch {
    /* current */
  }
  const key = monthKey(month);
  const [employees, payments, accounts, projects, attendance] = await Promise.all([
    db.employee.findMany({ where: { deletedAt: null, OR: [{ status: { not: "EXITED" } }, { exitDate: { gte: month } }] }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.transaction.findMany({ where: { deletedAt: null, type: "EXPENSE", employeeId: { not: null }, payrollMonth: key }, include: { account: { select: { name: true } } } }),
    accountOptions(),
    projectOptions(),
    db.attendance.groupBy({ by: ["employeeId", "status"], where: { date: { gte: month, lte: endOfMonth(month) } }, _count: true }),
  ]);
  const paidTo = (id: string) => payments.filter((p) => p.employeeId === id).reduce((a, p) => a.plus(D(p.amount)), new Decimal(0));
  const salaried = employees.filter((e) => e.type === "EMPLOYEE" && e.compensationType === "MONTHLY_SALARY");
  const expected = salaried.reduce((a, e) => a.plus(D(e.monthlySalary)), new Decimal(0));
  const paidTotal = payments.reduce((a, p) => a.plus(D(p.amount)), new Decimal(0));
  const canPay = can(user.access, "finance", "EDIT") || can(user.access, "team", "FULL");
  const fields = [
    { name: "employeeId", label: "", type: "hidden" as const },
    { name: "payrollMonth", label: "For month (YYYY-MM)", required: true },
    { name: "date", label: "Payment date", type: "date" as const, required: true },
    { name: "amount", label: "Amount (₹)", type: "money" as const, required: true, hint: "Net amount actually paid" },
    { name: "accountId", label: "Paid from", type: "select" as const, options: accounts, required: true },
    { name: "method", label: "Method", type: "select" as const, options: PAYMENT_METHOD_OPTIONS, emptyOption: false as const },
    { name: "reference", label: "Reference / UTR" },
    { name: "projectId", label: "Project (for freelancer cost)", type: "select" as const, options: projects },
    { name: "description", label: "Description", span: 2 as const },
    { name: "allowDuplicate", label: "This is an additional payment for the same month (bonus, arrears…)", type: "checkbox" as const, span: 2 as const },
  ];
  return (
    <>
      <PageHeader
        title="Payroll & Payouts"
        description="Record salary and freelancer payments. Each payment becomes an expense in Finance (Salaries / Freelancer Payments)."
        actions={
          <div className="flex items-center gap-2">
            <LinkButton href={`/team/payroll?month=${monthKey(addMonths(month, -1))}`} variant="outline" size="icon" aria-label="Previous month"><ChevronLeft /></LinkButton>
            <span className="min-w-[140px] text-center text-sm font-semibold">{monthLongLabel(month)}</span>
            <LinkButton href={`/team/payroll?month=${monthKey(addMonths(month, 1))}`} variant="outline" size="icon" aria-label="Next month"><ChevronRight /></LinkButton>
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Expected salaries" value={formatMoney(expected)} hint={`${salaried.length} salaried employee(s)`} />
        <StatCard label="Paid for this month" value={formatMoney(paidTotal)} hint={`${payments.length} payment(s)`} />
        <StatCard label="Salaries pending" value={salaried.filter((e) => paidTo(e.id).isZero()).length} tone={salaried.some((e) => paidTo(e.id).isZero()) ? "warning" : "default"} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title={`Team payments — ${monthLongLabel(month)}`} />
        {employees.length ? (
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5">Person</th><th className="px-4 py-2.5">Attendance</th><th className="px-4 py-2.5 text-right">Expected</th><th className="px-4 py-2.5 text-right">Paid</th><th className="px-4 py-2.5">Payments</th><th className="px-4 py-2.5" /></tr></thead>
              <tbody>
                {employees.map((e) => {
                  const paid = paidTo(e.id);
                  const exp = e.compensationType === "MONTHLY_SALARY" ? D(e.monthlySalary) : null;
                  const att = (s: string) => attendance.find((a) => a.employeeId === e.id && a.status === s)?._count ?? 0;
                  return (
                    <tr key={e.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3"><Link href={`/team/${e.id}`} className="font-medium hover:text-brand">{e.name}</Link><span className="block text-xs text-muted">{e.type === "FREELANCER" ? "Freelancer" : e.designation ?? "Employee"}</span></td>
                      <td className="px-4 py-3 text-xs text-muted">{e.type === "EMPLOYEE" ? `${att("PRESENT") + att("WORK_FROM_HOME")} P · ${att("HALF_DAY")} H · ${att("ABSENT")} A · ${att("ON_LEAVE")} L` : "—"}</td>
                      <td className="tabular px-4 py-3 text-right">{exp ? formatMoney(exp) : <span className="text-muted">Variable</span>}</td>
                      <td className="tabular px-4 py-3 text-right font-medium">{paid.gt(0) ? formatMoney(paid) : "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted">{payments.filter((p) => p.employeeId === e.id).map((p) => `${fmtDate(p.date)} · ${p.account.name}`).join("; ") || (exp ? <Badge tone="warning">Pending</Badge> : "—")}</td>
                      <td className="px-4 py-3 text-right">
                        {canPay ? (
                          <FormDialog trigger={<><Wallet /> Pay</>} triggerVariant={paid.gt(0) ? "ghost" : "outline"} triggerSize="sm" title={`Pay ${e.name}`} fields={fields} action={recordPayout}
                            defaults={{ employeeId: e.id, payrollMonth: key, date: isoDate(todayIST()), amount: exp && paid.isZero() ? exp.toFixed(2) : "", accountId: accounts[0]?.value, method: "BANK_TRANSFER" }} />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No team members" />}
      </Card>
      <p className="mt-3 text-xs text-muted">Statutory deductions (TDS on salary, PF, ESI, professional tax) are not computed automatically — record the net amount paid and the deductions as separate tax payments in Finance.</p>
    </>
  );
}
