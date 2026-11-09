import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { param, type SearchParams } from "@/lib/list";
import { addDays, endOfMonth, fmtDate, isoDate, startOfMonth, todayIST, toDateOnly, monthsInRange, monthLongLabel } from "@/lib/dates";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { InlineForm, SubmitButton } from "@/components/ui/form-dialog";
import { Input, Select } from "@/components/ui/fields";
import { LinkButton } from "@/components/ui/button";
import { saveAttendance } from "@/server/actions/team";

export const metadata = { title: "Attendance" };

const STATUSES = [
  { value: "PRESENT", label: "Present", short: "P" }, { value: "WORK_FROM_HOME", label: "Work from home", short: "W" }, { value: "HALF_DAY", label: "Half day", short: "H" },
  { value: "ABSENT", label: "Absent", short: "A" }, { value: "ON_LEAVE", label: "On leave", short: "L" }, { value: "HOLIDAY", label: "Holiday", short: "—" },
];

export default async function AttendancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("team");
  const sp = await searchParams;
  let date = todayIST();
  try {
    if (param(sp, "date")) date = toDateOnly(param(sp, "date")!);
  } catch {
    /* today */
  }
  const iso = isoDate(date);
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const [employees, today, month] = await Promise.all([
    db.employee.findMany({ where: { deletedAt: null, status: { not: "EXITED" }, type: "EMPLOYEE" }, orderBy: { name: "asc" } }),
    db.attendance.findMany({ where: { date } }),
    db.attendance.findMany({ where: { date: { gte: monthStart, lte: monthEnd } } }),
  ]);
  const canEdit = can(user.access, "team", "EDIT");
  const days = monthsInRange(monthStart, monthEnd).length ? Array.from({ length: monthEnd.getUTCDate() }, (_, i) => addDays(monthStart, i)) : [];
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Mark daily attendance for employees. Approved leave is filled in automatically."
        actions={
          <div className="flex items-center gap-2">
            <LinkButton href={`/team/attendance?date=${isoDate(addDays(date, -1))}`} variant="outline" size="icon" aria-label="Previous day"><ChevronLeft /></LinkButton>
            <form action="/team/attendance"><Input type="date" name="date" defaultValue={iso} className="w-auto" aria-label="Date" /></form>
            <LinkButton href={`/team/attendance?date=${isoDate(addDays(date, 1))}`} variant="outline" size="icon" aria-label="Next day"><ChevronRight /></LinkButton>
            <LinkButton href="/team/attendance" variant="ghost">Today</LinkButton>
          </div>
        }
      />
      {employees.length ? (
        <>
          <Card className="mb-6">
            <CardHeader title={`Attendance for ${fmtDate(date)}`} description={date.getUTCDay() === 0 ? "Sunday" : undefined} />
            <InlineForm action={saveAttendance.bind(null, iso)} successMessage="Attendance saved">
              <ul className="divide-y divide-line">
                {employees.map((e) => {
                  const rec = today.find((a) => a.employeeId === e.id);
                  return (
                    <li key={e.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                      <span className="w-56 text-sm font-medium">{e.name}<span className="block text-xs font-normal text-muted">{e.designation}</span></span>
                      <Select name={`status_${e.id}`} defaultValue={rec?.status ?? ""} disabled={!canEdit} className="sm:w-48" aria-label={`Status for ${e.name}`}>
                        <option value="">— Not marked —</option>
                        {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </Select>
                      <Input name={`notes_${e.id}`} defaultValue={rec?.notes ?? ""} placeholder="Note (optional)" disabled={!canEdit} className="sm:max-w-xs" />
                    </li>
                  );
                })}
              </ul>
              {canEdit ? <div className="flex justify-end border-t border-line px-5 py-3"><SubmitButton>Save attendance</SubmitButton></div> : null}
            </InlineForm>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title={`${monthLongLabel(monthStart)} register`} description="P present · W WFH · H half day · A absent · L leave" />
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full text-center text-xs">
                <thead><tr className="border-b border-line bg-surface-2 text-muted"><th className="sticky left-0 bg-surface-2 px-3 py-2 text-left">Name</th>{days.map((d) => <th key={d.toISOString()} className={`px-1.5 py-2 ${d.getUTCDay() === 0 ? "text-subtle" : ""}`}><Link href={`/team/attendance?date=${isoDate(d)}`}>{d.getUTCDate()}</Link></th>)}<th className="px-3 py-2">P</th><th className="px-3 py-2">A</th><th className="px-3 py-2">L</th></tr></thead>
                <tbody>
                  {employees.map((e) => {
                    const recs = month.filter((a) => a.employeeId === e.id);
                    return (
                      <tr key={e.id} className="border-b border-line last:border-0">
                        <td className="sticky left-0 whitespace-nowrap bg-surface px-3 py-2 text-left font-medium">{e.name}</td>
                        {days.map((d) => {
                          const r = recs.find((a) => isoDate(a.date) === isoDate(d));
                          const s = STATUSES.find((x) => x.value === r?.status);
                          return <td key={d.toISOString()} className={`px-1.5 py-2 ${r?.status === "ABSENT" ? "text-danger" : r?.status === "ON_LEAVE" ? "text-warning" : r ? "text-success" : "text-subtle"}`}>{s?.short ?? "·"}</td>;
                        })}
                        <td className="px-3 py-2 font-medium">{recs.filter((r) => ["PRESENT", "WORK_FROM_HOME"].includes(r.status)).length + recs.filter((r) => r.status === "HALF_DAY").length / 2}</td>
                        <td className="px-3 py-2">{recs.filter((r) => r.status === "ABSENT").length}</td>
                        <td className="px-3 py-2">{recs.filter((r) => r.status === "ON_LEAVE").length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card><EmptyState title="No employees" description="Add employees in Employees & Freelancers to track attendance." /></Card>
      )}
    </>
  );
}
