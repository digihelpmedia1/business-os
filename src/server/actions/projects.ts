"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, requireActionAccess, type CurrentUser } from "@/lib/auth";
import { run, formToObject, ActionError, type ActionState } from "@/lib/action";
import { audit, diff } from "@/lib/audit";
import { emitEvent } from "@/lib/integrations";
import { can } from "@/lib/permissions";
import { addMonths } from "@/lib/dates";
import { checkbox, dateStr, optDate, optId, optMoney, optStr, reqStr } from "@/lib/validators";

function revalidateProjects(id?: string) {
  revalidatePath("/projects", "layout");
  if (id) revalidatePath(`/projects/${id}`);
  revalidatePath("/my-work");
  revalidatePath("/dashboard");
}

/** EDIT on projects, or the assignee of the task (for status/time updates). */
async function requireTaskWorker(taskId: string | null): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has expired.");
  if (can(user.access, "projects", "EDIT")) return user;
  if (taskId && user.employeeId) {
    const task = await db.task.findUnique({ where: { id: taskId }, select: { assigneeId: true } });
    if (task?.assigneeId === user.employeeId) return user;
  }
  throw new ActionError("You can only update tasks assigned to you.");
}

// ───────── Projects ─────────

const projectSchema = z.object({
  name: reqStr("Project name", 150),
  code: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(30).optional()).transform((v) => v ?? null),
  clientId: optId,
  serviceId: optId,
  managerId: optId,
  description: optStr(5000),
  status: z.enum(["PLANNING", "NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]),
  billingType: z.enum(["FIXED", "RETAINER", "HOURLY", "NON_BILLABLE"]),
  budget: optMoney("Budget"),
  monthlyFee: optMoney("Monthly fee"),
  startDate: optDate(),
  endDate: optDate(),
});

export async function saveProject(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "EDIT");
    const input = projectSchema.parse(formToObject(fd));
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw new ActionError("End date is before start date.", { endDate: "Before start date" });
    if (input.billingType === "RETAINER" && !input.monthlyFee) throw new ActionError("Retainer projects need a monthly fee.", { monthlyFee: "Required for retainers" });
    let projectId = id;
    if (id) {
      const before = await db.project.findUniqueOrThrow({ where: { id } });
      const completedAt = input.status === "COMPLETED" ? (before.completedAt ?? new Date()) : null;
      await db.project.update({ where: { id }, data: { ...input, completedAt } });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Project", entityId: id, summary: `Project ${input.name} updated`, changes: diff(before, input) });
      if (before.status !== input.status) emitEvent("project.status_changed", { id, name: input.name, from: before.status, to: input.status });
    } else {
      const p = await db.project.create({ data: { ...input, completedAt: input.status === "COMPLETED" ? new Date() : null } });
      projectId = p.id;
      await audit({ userId: user.id, action: "CREATE", entityType: "Project", entityId: p.id, summary: `Project ${input.name} created` });
      emitEvent("project.created", p);
    }
    revalidateProjects(projectId ?? undefined);
    return { ok: true, message: "Project saved", redirectTo: id ? undefined : `/projects/${projectId}` };
  });
}

export async function setProjectStatus(id: string, status: "PLANNING" | "NOT_STARTED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED"): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "EDIT");
    const p = await db.project.update({ where: { id }, data: { status, completedAt: status === "COMPLETED" ? new Date() : null } });
    await audit({ userId: user.id, action: "STATUS", entityType: "Project", entityId: id, summary: `${p.name} → ${status}` });
    emitEvent("project.status_changed", { id, name: p.name, to: status });
    revalidateProjects(id);
    return { ok: true, message: "Status updated" };
  });
}

export async function archiveProject(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "FULL");
    const p = await db.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ userId: user.id, action: "ARCHIVE", entityType: "Project", entityId: id, summary: `Project ${p.name} archived` });
    revalidateProjects();
    return { ok: true, message: "Project archived", redirectTo: "/projects" };
  });
}

/** Retainers: copy tasks marked recurring into the next month with shifted dates. */
export async function rollOverRecurringTasks(projectId: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "EDIT");
    const tasks = await db.task.findMany({ where: { projectId, isRecurring: true, deletedAt: null, parentId: null }, include: { subtasks: { where: { deletedAt: null } } } });
    if (!tasks.length) throw new ActionError("Mark tasks as “repeats monthly” first.");
    // Only roll the latest occurrence of each title forward.
    const latest = new Map<string, (typeof tasks)[number]>();
    for (const t of tasks) {
      const prev = latest.get(t.title);
      if (!prev || (t.dueDate ?? t.createdAt) > (prev.dueDate ?? prev.createdAt)) latest.set(t.title, t);
    }
    let created = 0;
    await db.$transaction(async (tx) => {
      for (const t of latest.values()) {
        const nt = await tx.task.create({
          data: {
            projectId, title: t.title, description: t.description, priority: t.priority, assigneeId: t.assigneeId, isRecurring: true,
            estimateHours: t.estimateHours, startDate: t.startDate ? addMonths(t.startDate, 1) : null, dueDate: t.dueDate ? addMonths(t.dueDate, 1) : null,
          },
        });
        for (const s of t.subtasks) {
          await tx.task.create({ data: { projectId, parentId: nt.id, title: s.title, priority: s.priority, assigneeId: s.assigneeId, dueDate: s.dueDate ? addMonths(s.dueDate, 1) : null } });
        }
        created++;
      }
      await audit({ userId: user.id, action: "ROLLOVER", entityType: "Project", entityId: projectId, summary: `${created} recurring task(s) rolled over to next month` }, tx);
    });
    revalidateProjects(projectId);
    return { ok: true, message: `${created} task(s) created for next month` };
  });
}

// ───────── Tasks ─────────

const taskSchema = z.object({
  projectId: z.string().min(1, "Select a project"),
  parentId: optId,
  title: reqStr("Title", 200),
  description: optStr(5000),
  status: z.enum(["TODO", "IN_PROGRESS", "REVIEW", "DONE"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  assigneeId: optId,
  startDate: optDate(),
  dueDate: optDate(),
  estimateHours: z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(0).max(1000).optional()).transform((v) => (v === undefined ? null : String(v))),
  isRecurring: checkbox,
});

export async function saveTask(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "EDIT");
    const input = taskSchema.parse(formToObject(fd));
    if (input.startDate && input.dueDate && input.dueDate < input.startDate) throw new ActionError("Due date is before start date.", { dueDate: "Before start date" });
    if (input.parentId) {
      const parent = await db.task.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.projectId !== input.projectId) throw new ActionError("Parent task must belong to the same project.");
      if (parent.parentId) throw new ActionError("Subtasks can only be one level deep.");
    }
    const data = { ...input, completedAt: input.status === "DONE" ? new Date() : null };
    if (id) {
      if (input.parentId === id) throw new ActionError("A task cannot be its own parent.");
      const before = await db.task.findUniqueOrThrow({ where: { id } });
      await db.task.update({ where: { id }, data: { ...data, completedAt: input.status === "DONE" ? (before.completedAt ?? new Date()) : null } });
      await audit({ userId: user.id, action: "UPDATE", entityType: "Task", entityId: id, summary: `Task “${input.title}” updated` });
    } else {
      const t = await db.task.create({ data });
      await audit({ userId: user.id, action: "CREATE", entityType: "Task", entityId: t.id, summary: `Task “${input.title}” created` });
    }
    revalidateProjects(input.projectId);
    return { ok: true, message: "Task saved" };
  });
}

export async function moveTask(id: string, status: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE"): Promise<ActionState> {
  return run(async () => {
    const user = await requireTaskWorker(id);
    const t = await db.task.findUniqueOrThrow({ where: { id } });
    if (t.status === status) return { ok: true };
    if (status === "DONE") {
      const open = await db.task.count({ where: { parentId: id, deletedAt: null, status: { not: "DONE" } } });
      if (open) throw new ActionError(`Finish the ${open} open subtask(s) first.`);
    }
    await db.task.update({ where: { id }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
    await audit({ userId: user.id, action: "STATUS", entityType: "Task", entityId: id, summary: `“${t.title}”: ${t.status} → ${status}` });
    if (status === "DONE") emitEvent("task.completed", { id, title: t.title, projectId: t.projectId, completedBy: user.name });
    revalidateProjects(t.projectId);
    return { ok: true, message: status === "DONE" ? "Task completed" : "Task moved" };
  });
}

export async function deleteTask(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "FULL");
    const t = await db.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await db.task.updateMany({ where: { parentId: id }, data: { deletedAt: new Date() } });
    await audit({ userId: user.id, action: "DELETE", entityType: "Task", entityId: id, summary: `Task “${t.title}” deleted` });
    revalidateProjects(t.projectId);
    return { ok: true, message: "Task deleted" };
  });
}

// ───────── Milestones & deliverables ─────────

const itemSchema = z.object({
  title: reqStr("Title", 200),
  dueDate: optDate(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE"]).default("PENDING"),
  amount: optMoney("Amount"),
});

export async function saveMilestone(projectId: string, id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "EDIT");
    const input = itemSchema.parse(formToObject(fd));
    const data = { ...input, completedAt: input.status === "DONE" ? new Date() : null };
    if (id) await db.milestone.update({ where: { id }, data });
    else await db.milestone.create({ data: { ...data, projectId } });
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "Milestone", entityId: id ?? projectId, summary: `Milestone “${input.title}” saved` });
    revalidateProjects(projectId);
    return { ok: true, message: "Milestone saved" };
  });
}

export async function saveDeliverable(projectId: string, id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "EDIT");
    const { amount: _a, ...input } = itemSchema.parse(formToObject(fd));
    if (id) await db.deliverable.update({ where: { id }, data: input });
    else await db.deliverable.create({ data: { ...input, projectId } });
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "Deliverable", entityId: id ?? projectId, summary: `Deliverable “${input.title}” saved` });
    revalidateProjects(projectId);
    return { ok: true, message: "Deliverable saved" };
  });
}

export async function deleteProjectItem(kind: "milestone" | "deliverable", id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "FULL");
    const rec = kind === "milestone" ? await db.milestone.delete({ where: { id } }) : await db.deliverable.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: kind === "milestone" ? "Milestone" : "Deliverable", entityId: id, summary: `${kind} “${rec.title}” deleted` });
    revalidateProjects(rec.projectId);
    return { ok: true, message: "Deleted" };
  });
}

// ───────── Time tracking ─────────

const timeSchema = z.object({
  employeeId: optId,
  projectId: z.string().min(1, "Select a project"),
  taskId: optId,
  date: dateStr("Date"),
  hours: z.coerce.number({ error: "Enter hours" }).gt(0, "Hours must be more than 0").max(24, "Max 24 hours per entry"),
  billable: checkbox,
  description: optStr(500),
});

export async function saveTimeEntry(id: string | null, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Session expired.");
    const input = timeSchema.parse(formToObject(fd));
    const manager = can(user.access, "projects", "EDIT");
    const employeeId = manager ? (input.employeeId ?? user.employeeId) : user.employeeId;
    if (!employeeId) throw new ActionError(manager ? "Select the team member." : "Your user isn't linked to an employee profile.", { employeeId: "Required" });
    if (!manager && !can(user.access, "projects", "VIEW")) throw new ActionError("You don't have access to projects.");
    if (input.taskId) {
      const task = await db.task.findUnique({ where: { id: input.taskId } });
      if (!task || task.projectId !== input.projectId) throw new ActionError("Task doesn't belong to the selected project.", { taskId: "Wrong project" });
    }
    if (id) {
      const existing = await db.timeEntry.findUniqueOrThrow({ where: { id } });
      if (!manager && existing.employeeId !== user.employeeId) throw new ActionError("You can only edit your own time entries.");
    }
    const emp = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const costRate = emp.costPerHour ?? (emp.monthlySalary ? emp.monthlySalary.dividedBy(176).toDecimalPlaces(2) : emp.hourlyRate) ?? 0;
    const data = { ...input, employeeId, hours: input.hours.toFixed(2), costRate: costRate.toString() };
    if (id) await db.timeEntry.update({ where: { id }, data });
    else await db.timeEntry.create({ data });
    await audit({ userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "TimeEntry", entityId: id ?? input.projectId, summary: `${input.hours}h logged by ${emp.name}` });
    revalidateProjects(input.projectId);
    return { ok: true, message: "Time saved" };
  });
}

export async function deleteTimeEntry(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await getCurrentUser();
    if (!user) throw new ActionError("Session expired.");
    const e = await db.timeEntry.findUniqueOrThrow({ where: { id } });
    if (!can(user.access, "projects", "FULL") && e.employeeId !== user.employeeId) throw new ActionError("You can only delete your own time entries.");
    await db.timeEntry.delete({ where: { id } });
    await audit({ userId: user.id, action: "DELETE", entityType: "TimeEntry", entityId: id, summary: `Time entry (${e.hours}h) deleted` });
    revalidateProjects(e.projectId);
    return { ok: true, message: "Time entry deleted" };
  });
}

// ───────── Notes ─────────

export async function addProjectNote(projectId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "VIEW");
    const body = z.string().trim().min(1, "Write a note").max(5000).parse(fd.get("body"));
    await db.projectNote.create({ data: { projectId, authorId: user.id, body } });
    revalidateProjects(projectId);
    return { ok: true, message: "Note added" };
  });
}

export async function deleteProjectNote(id: string): Promise<ActionState> {
  return run(async () => {
    const user = await requireActionAccess("projects", "VIEW");
    const n = await db.projectNote.findUniqueOrThrow({ where: { id } });
    if (n.authorId !== user.id && !can(user.access, "projects", "FULL")) throw new ActionError("You can only delete your own notes.");
    await db.projectNote.delete({ where: { id } });
    revalidateProjects(n.projectId);
    return { ok: true, message: "Note deleted" };
  });
}
