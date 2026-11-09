import { Check, Plus, X } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams } from "@/lib/list";
import { fmtDate, isoDate, todayIST } from "@/lib/dates";
import { employeeOptions } from "@/lib/options";
import { PageHeader, StatCard } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusBadge } from "@/components/status-badge";
import { applyLeave, setLeaveStatus } from "@/server/actions/team";

export const metadata = { title: "Leave" };

const TYPES = [{ value: "CASUAL", label: "Casual" }, { value: "SICK", label: "Sick" }, { value: "EARNED", label: "Earned / privilege" }, { value: "UNPAID", label: "Unpaid" }, { value: "OTHER", label: "Other" }];

export default async function LeavePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("team");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["startDate", "createdAt"] as const, defaultSort: "startDate" });
  const where: Prisma.LeaveRecordWhereInput = {
    ...(param(sp, "status") ? { status: param(sp, "status") as "PENDING" } : {}),
    ...(param(sp, "employeeId") ? { employeeId: param(sp, "employeeId") } : {}),
    ...(param(sp, "type") ? { type: param(sp, "type") as "SICK" } : {}),
    ...(list.q ? { employee: { name: { contains: list.q, mode: "insensitive" } } } : {}),
  };
  const today = todayIST();
  const [rows, total, employees, pending, onLeave] = await Promise.all([
    db.leaveRecord.findMany({ where, include: { employee: { select: { name: true } } }, orderBy: { [list.sort]: list.dir }, skip: list.skip, take: list.pageSize }),
    db.leaveRecord.count({ where }),
    employeeOptions(),
    db.leaveRecord.count({ where: { status: "PENDING" } }),
    db.leaveRecord.count({ where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today } } }),
  ]);
  const canEdit = can(user.access, "team", "EDIT");
  const canFull = can(user.access, "team", "FULL");
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "emp", header: "Person", render: (l) => l.employee.name },
    { key: "type", header: "Type", render: (l) => l.type.charAt(0) + l.type.slice(1).toLowerCase() },
    { key: "dates", header: "Dates", sortKey: "startDate", render: (l) => `${fmtDate(l.startDate)}${l.endDate.getTime() !== l.startDate.getTime() ? ` – ${fmtDate(l.endDate)}` : ""}` },
    { key: "days", header: "Days", align: "right", render: (l) => String(l.days) },
    { key: "reason", header: "Reason", render: (l) => <span className="text-[13px] text-muted">{l.reason ?? "—"}</span> },
    { key: "status", header: "Status", render: (l) => <StatusBadge status={l.status} /> },
    {
      key: "a", header: "", align: "right",
      render: (l) => (
        <div className="flex justify-end gap-1">
          {canFull && l.status === "PENDING" ? (
            <>
              <ConfirmAction action={setLeaveStatus.bind(null, l.id, "APPROVED")} label={<Check />} noConfirm variant="ghost" size="icon-sm" />
              <ConfirmAction action={setLeaveStatus.bind(null, l.id, "REJECTED")} label={<X />} title="Reject leave?" confirmLabel="Reject" variant="ghost" size="icon-sm" />
            </>
          ) : null}
          {(canEdit || l.employeeId === user.employeeId) && ["PENDING", "APPROVED"].includes(l.status) && l.startDate >= today ? (
            <ConfirmAction action={setLeaveStatus.bind(null, l.id, "CANCELLED")} label="Cancel" title="Cancel this leave?" confirmLabel="Cancel leave" variant="ghost" size="sm" />
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Leave"
        description={canFull ? "Approve requests and record leave. Approved leave marks attendance automatically." : "Record and review leave."}
        actions={canEdit || user.employeeId ? (
          <FormDialog trigger={<><Plus /> {canEdit ? "Record leave" : "Request leave"}</>} title={canEdit ? "Record leave" : "Request leave"}
            fields={[
              ...(canEdit ? [{ name: "employeeId", label: "Person", type: "select" as const, options: employees, required: true }] : []),
              { name: "type", label: "Leave type", type: "select", options: TYPES, emptyOption: false },
              { name: "startDate", label: "From", type: "date", required: true },
              { name: "endDate", label: "To", type: "date", required: true },
              { name: "halfDay", label: "Half day (single date only)", type: "checkbox" },
              { name: "reason", label: "Reason", type: "textarea" },
            ]}
            defaults={{ type: "CASUAL", startDate: isoDate(today), endDate: isoDate(today), employeeId: user.employeeId }}
            action={applyLeave}
          />
        ) : null}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Pending requests" value={pending} tone={pending ? "warning" : "default"} href="/team/leave?status=PENDING" />
        <StatCard label="On leave today" value={onLeave} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/team/leave"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={<ListToolbar placeholder="Search by name…" filters={[{ type: "select", name: "status", label: "Status", options: [{ value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }, { value: "CANCELLED", label: "Cancelled" }] }, { type: "select", name: "employeeId", label: "Person", options: employees }, { type: "select", name: "type", label: "Type", options: TYPES }]} />}
        empty={{ title: "No leave records" }}
      />
    </>
  );
}
