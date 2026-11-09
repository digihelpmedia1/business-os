"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, requireActionAccess } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { emitEvent } from "@/lib/integrations";
import { D } from "@/lib/money";
import { can } from "@/lib/permissions";
import { daysBetween, toDateOnly } from "@/lib/dates";
import { dateStr, email, money, optDate, optId, optMoney, optStr, pan, phone, reqStr } from "@/lib/validators";
import { systemCategory } from "@/server/services/billing";

function revalidateTeam(id?: string) {
  revalidatePath("/team", "layout");
  if (id) revalidatePath(`/team/${id}`);
}

const employeeSchema = z.object({
  type: z.enum(["EMPLOYEE", "FREELANCER"]),
  name: reqStr("Name", 120),
  email,
  phone,
  designation: optStr(100),
  department: optStr(100),
  joiningDate: optDate(),
  exitDate: optDate(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "EXITED"]),
  compensationType: z.enum(["MONTHLY_SALARY", "HOURLY", "PER_PROJECT"]),
  monthlySalary: optMoney("Monthly salary"),
  hourlyRate: optMoney("Hourly rate"),
  costPerHour: optMoney("Cost per hour"),
  pan,
  bankAccount: optStr(40),
  bankIfsc: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v), z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC").optional()).transform((v) => v ?? null),
  upiId: optStr(80),
  address: optStr(500),
  notes: optStr(2000),
  userId: optId,
});

export async function saveEmployee(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("team", "EDIT");
    const input = employeeSchema.parse(formToObject(fd));
    if (input.compensationType === "MONTHLY_SALARY" && !input.monthlySalary) throw new ActionError("Enter the monthly salary.", { monthlySalary: "Required" });
    if (input.compensationType === "HOURLY" && !input.hourlyRate) throw new ActionError("Enter the hourly rate.", { hourlyRate: "Required" });
    if (input.exitDate && input.joiningDate && input.exitDate < input.joiningDate) throw new ActionError("Exit date is before joining date.", { exitDate: "Before joining" });
    if (input.userId) {
      const linked = await db.employee.findFirst({ where: { userId: input.userId, ...(id ? { NOT: { id } } : {}) } });
      if (linked) throw new ActionError(`That user is already linked to ${linked.name}.`, { userId: "Already linked" });
    }
    if (input.email) {
      const dup = await db.employee.findFirst({ where: { deletedAt: null, email: { equals: input.email, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
      if (dup) throw new ActionError(`${dup.name} already uses this email.`, { email: "Duplicate" });
    }
    let empId = id;
    await db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.employee.findUniqueOrThrow({ where: { id } });
        await tx.employee.update({ where: { id }, data: input });
        if (input.monthlySalary && !D(before.monthlySalary).eq(D(input.monthlySalary))) {
          await tx.salaryRecord.create({ data: { employeeId: id, effectiveFrom: toDateOnly(new Date().toISOString().slice(0, 10)), monthlySalary: input.monthlySalary, notes: "Salary revised" } });
        }
        const changes = diff(before, input);
        delete (changes as Record<string, unknown>).bankAccount;
        await audit({ userId: user.id, action: "UPDATE", entityType: "Employee", entityId: id, summary: `${input.name} updated`, changes }, tx);
      } else {
        const e = await tx.employee.create({ data: input });
        empId = e.id;
        if (input.monthlySalary) {
          await tx.salaryRecord.create({ data: { employeeId: e.id, effectiveFrom: input.joiningDate ?? toDateOnly(new Date().toISOString().slice(0, 10)), monthlySalary: input.monthlySalary, notes: "Starting salary" } });
        }
        await audit({ userId: user.id, action: "CREATE", entityType: "Employee", entityId: e.id, summary: `${input.type === "FREELANCER" ? "Freelancer" : "Employee"} ${input.name} added` }, tx);
      }
    });
    revalidateTeam(empId ?? undefined);
    return { ok: true, message: "Saved", redirectTo: id ? undefined : `/team/${empId}` };
  });
}

export async function archiveEmployee(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("team", "FULL");
    const e = await db.employee.update({ where: { id }, data: { deletedAt: new Date(), status: "EXITED" } });
    await db.task.updateMany({ where: { assigneeId: id, status: { not: "DONE" } }, data: { assigneeId: null } });
    await db.asset.updateMany({ where: { assignedEmployeeId: id }, data: { assignedEmployeeId: null, status: "IN_STOCK" } });
    await audit({ userId: user.id, action: "ARCHIVE", entityType: "Employee", entityId: id, summary: `${e.name} archived; open tasks unassigned, assets returned to stock` });
    revalidateTeam();
    return { ok: true, message: "Archived", redirectTo: "/team" };
  });
}

// ───────── Attendance ─────────

export async function saveAttendance(dateIso: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("team", "EDIT");
    const date = toDateOnly(dateIso);
    const statuses = ["PRESENT", "ABSENT", "HALF_DAY", "WORK_FROM_HOME", "ON_LEAVE", "HOLIDAY"] as const;
    let count = 0;
    await db.$transaction(async (tx) => {
      for (const [key, value] of fd.entries()) {
        if (!key.startsWith("status_") || typeof value !== "string") continue;
        const employeeId = key.slice(7);
        if (!value) {
          await tx.attendance.deleteMany({ where: { employeeId, date } });
          continue;
        }
        if (!statuses.includes(value as (typeof statuses)[number])) continue;
        const notes = (fd.get(`notes_${employeeId}`) as string | null)?.trim() || null;
        await tx.attendance.upsert({
          where: { employeeId_date: { employeeId, date } },
          create: { employeeId, date, status: value as (typeof statuses)[number], notes },
          update: { status: value as (typeof statuses)[number], notes },
        });
        count++;
      }
      await audit({ userId: user.id, action: "ATTENDANCE", entityType: "Attendance", entityId: dateIso, summary: `Attendance saved for ${dateIso} (${count} people)` }, tx);
    });
    revalidateTeam();
    return { ok: true, message: `Attendance saved for ${count} people` };
  });
}

// ───────── Leave ─────────

const leaveSchema = z.object({
  employeeId: optId,
  type: z.enum(["CASUAL", "SICK", "EARNED", "UNPAID", "OTHER"]),
  startDate: dateStr("Start date"),
  endDate: dateStr("End date"),
  halfDay: z.preprocess((v) => v === "on", z.boolean()),
  reason: optStr(500),
});

export async function applyLeave(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Session expired.");
    const input = leaveSchema.parse(formToObject(fd));
    const manager = can(user.access, "team", "EDIT");
    const employeeId = manager ? (input.employeeId ?? user.employeeId) : user.employeeId;
    if (!employeeId) throw new ActionError(manager ? "Select the team member." : "Your user isn't linked to an employee profile.", { employeeId: "Required" });
    if (input.endDate < input.startDate) throw new ActionError("End date is before start date.", { endDate: "Before start" });
    const overlap = await db.leaveRecord.findFirst({ where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: input.endDate }, endDate: { gte: input.startDate } } });
    if (overlap) throw new ActionError("This overlaps an existing leave request.");
    const days = input.halfDay && daysBetween(input.startDate, input.endDate) === 0 ? 0.5 : daysBetween(input.startDate, input.endDate) + 1;
    const l = await db.leaveRecord.create({ data: { employeeId, type: input.type, startDate: input.startDate, endDate: input.endDate, days: String(days), reason: input.reason, status: manager ? "APPROVED" : "PENDING" } });
    if (!manager) emitEvent("leave.requested", l);
    await audit({ userId: user.id, action: "LEAVE", entityType: "LeaveRecord", entityId: l.id, summary: `${days} day(s) ${input.type.toLowerCase()} leave ${manager ? "recorded" : "requested"}` });
    revalidateTeam(employeeId);
    revalidatePath("/my-work");
    return { ok: true, message: manager ? "Leave recorded" : "Leave request submitted" };
  });
}

export async function setLeaveStatus(id: string, status: "APPROVED" | "REJECTED" | "CANCELLED"): Promise<ActionState> {
  return run(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Session expired.");
    const l = await db.leaveRecord.findUniqueOrThrow({ where: { id }, include: { employee: true } });
    const own = user.employeeId === l.employeeId;
    if (status === "CANCELLED" ? !(own || can(user.access, "team", "EDIT")) : !can(user.access, "team", "FULL")) throw new ActionError("You can't change this leave request.");
    await db.$transaction(async (tx) => {
      await tx.leaveRecord.update({ where: { id }, data: { status } });
      if (status === "APPROVED") {
        for (let d = l.startDate; d <= l.endDate; d = new Date(d.getTime() + 86_400_000)) {
          await tx.attendance.upsert({ where: { employeeId_date: { employeeId: l.employeeId, date: d } }, create: { employeeId: l.employeeId, date: d, status: "ON_LEAVE", notes: `${l.type.toLowerCase()} leave` }, update: { status: "ON_LEAVE" } });
        }
      }
      await audit({ userId: user.id, action: status, entityType: "LeaveRecord", entityId: id, summary: `${l.employee.name}'s leave ${status.toLowerCase()}` }, tx);
    });
    revalidateTeam(l.employeeId);
    revalidatePath("/my-work");
    return { ok: true, message: `Leave ${status.toLowerCase()}` };
  });
}

// ───────── Payroll & payouts ─────────

const payoutSchema = z.object({
  employeeId: z.string().min(1, "Select a person"),
  payrollMonth: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  date: dateStr("Payment date"),
  amount: money("Amount", { allowZero: false }),
  accountId: z.string().min(1, "Select an account"),
  method: z.enum(["BANK_TRANSFER", "UPI", "CASH", "CHEQUE", "CARD", "PAYMENT_GATEWAY", "OTHER"]),
  reference: optStr(120),
  projectId: optId,
  description: optStr(200),
  allowDuplicate: z.preprocess((v) => v === "on", z.boolean()),
});

export async function recordPayout(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("team", "EDIT");
    if (!can(user.access, "finance", "EDIT") && !can(user.access, "team", "FULL")) throw new ActionError("Recording payments needs Edit access to Finance or Full access to Team.");
    const input = payoutSchema.parse(formToObject(fd));
    const emp = await db.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
    const existing = await db.transaction.findFirst({ where: { employeeId: emp.id, payrollMonth: input.payrollMonth, deletedAt: null, type: "EXPENSE" } });
    if (existing && !input.allowDuplicate && emp.type === "EMPLOYEE") {
      throw new ActionError(`A payment for ${emp.name} for ${input.payrollMonth} already exists (₹${existing.amount.toFixed(2)}). Tick “additional payment” to record another.`, { allowDuplicate: "Already paid this month" });
    }
    const account = await db.account.findUniqueOrThrow({ where: { id: input.accountId } });
    if (input.date < account.openingDate) throw new ActionError(`Date is before the opening date of ${account.name}.`);
    const category = await systemCategory(db, emp.type === "FREELANCER" ? "Freelancer Payments" : "Salaries & Wages", "EXPENSE", emp.type === "FREELANCER" ? "COST_OF_SERVICES" : "OPERATING_EXPENSE");
    await db.transaction.create({
      data: {
        type: "EXPENSE", date: input.date, amount: input.amount, accountId: input.accountId, method: input.method, reference: input.reference, categoryId: category.id,
        employeeId: emp.id, payrollMonth: input.payrollMonth, projectId: input.projectId,
        description: input.description || `${emp.type === "FREELANCER" ? "Payout" : "Salary"} — ${emp.name} — ${input.payrollMonth}`, createdById: user.id,
      },
    });
    await audit({ userId: user.id, action: "PAYOUT", entityType: "Employee", entityId: emp.id, summary: `₹${input.amount} paid to ${emp.name} for ${input.payrollMonth}` });
    revalidateTeam(emp.id);
    revalidatePath("/finance", "layout");
    return { ok: true, message: `Payment to ${emp.name} recorded` };
  });
}
