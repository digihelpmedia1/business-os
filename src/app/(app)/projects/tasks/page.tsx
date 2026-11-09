import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { param, type SearchParams } from "@/lib/list";
import { isoDate, todayIST, addDays } from "@/lib/dates";
import { employeeOptions, projectOptions } from "@/lib/options";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { TaskBoard, type BoardTask } from "@/components/projects/task-board";
import { saveTask } from "@/server/actions/projects";
import { taskFields } from "../fields";

export const metadata = { title: "Tasks Board" };

export default async function TasksBoardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("projects");
  const sp = await searchParams;
  const mine = param(sp, "mine") === "1";
  const projectId = param(sp, "projectId");
  const assigneeId = param(sp, "assigneeId");
  const priority = param(sp, "priority");
  const due = param(sp, "due");
  const today = todayIST();
  const q = param(sp, "q");
  const where: Prisma.TaskWhereInput = {
    deletedAt: null,
    parentId: null,
    project: { deletedAt: null, status: { notIn: ["CANCELLED"] } },
    ...(mine && user.employeeId ? { assigneeId: user.employeeId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(assigneeId ? { assigneeId: assigneeId === "none" ? null : assigneeId } : {}),
    ...(priority ? { priority: priority as "HIGH" } : {}),
    ...(due === "overdue" ? { dueDate: { lt: today }, status: { not: "DONE" } } : due === "week" ? { dueDate: { gte: today, lte: addDays(today, 7) } } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    // Hide tasks completed more than 30 days ago to keep the board focused.
    NOT: { status: "DONE", completedAt: { lt: addDays(today, -30) } },
  };
  const [tasks, projects, employees] = await Promise.all([
    db.task.findMany({
      where,
      include: { assignee: { select: { name: true } }, project: { select: { id: true, name: true } }, subtasks: { where: { deletedAt: null }, select: { status: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
      take: 400,
    }),
    projectOptions({ activeOnly: true }),
    employeeOptions(),
  ]);
  const canEdit = can(user.access, "projects", "EDIT");
  const board: BoardTask[] = tasks.map((t) => ({
    id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate ? isoDate(t.dueDate) : null, assignee: t.assignee?.name ?? null,
    project: t.project, subtasks: t.subtasks.length, subtasksDone: t.subtasks.filter((s) => s.status === "DONE").length, isRecurring: t.isRecurring,
    canMove: canEdit || (!!user.employeeId && t.assigneeId === user.employeeId),
  }));
  return (
    <>
      <PageHeader
        title="Tasks Board"
        description="Drag tasks between columns to update their status. Completed tasks older than 30 days are hidden."
        actions={canEdit ? <FormDialog trigger={<><Plus /> New task</>} title="New task" fields={taskFields({ projects, employees })} defaults={{ status: "TODO", priority: "MEDIUM" }} action={saveTask.bind(null, null)} size="lg" /> : null}
      />
      <Card className="mb-4">
        <ListToolbar
          placeholder="Search tasks…"
          filters={[
            ...(user.employeeId ? [{ type: "select" as const, name: "mine", label: "Show", options: [{ value: "1", label: "My tasks" }] }] : []),
            { type: "select", name: "projectId", label: "Project", options: projects },
            { type: "select", name: "assigneeId", label: "Assignee", options: [{ value: "none", label: "Unassigned" }, ...employees] },
            { type: "select", name: "priority", label: "Priority", options: [{ value: "URGENT", label: "Urgent" }, { value: "HIGH", label: "High" }, { value: "MEDIUM", label: "Medium" }, { value: "LOW", label: "Low" }] },
            { type: "select", name: "due", label: "Due", options: [{ value: "overdue", label: "Overdue" }, { value: "week", label: "Next 7 days" }] },
          ]}
        />
      </Card>
      <TaskBoard tasks={board} today={isoDate(today)} />
    </>
  );
}
