"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, ListTree, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { moveTask } from "@/server/actions/projects";

export type BoardTask = {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate: string | null; // ISO date
  assignee: string | null;
  project: { id: string; name: string } | null;
  subtasks: number;
  subtasksDone: number;
  isRecurring: boolean;
  canMove: boolean;
};

const COLUMNS: { key: BoardTask["status"]; label: string }[] = [
  { key: "TODO", label: "To do" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "REVIEW", label: "Review" },
  { key: "DONE", label: "Done" },
];

const PRIORITY: Record<BoardTask["priority"], string> = {
  LOW: "bg-surface-2 text-muted",
  MEDIUM: "bg-info-soft text-brand",
  HIGH: "bg-warning-soft text-warning",
  URGENT: "bg-danger-soft text-danger",
};

export function TaskBoard({ tasks, today, showProject = true }: { tasks: BoardTask[]; today: string; showProject?: boolean }) {
  const router = useRouter();
  const [items, setItems] = React.useState(tasks);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  React.useEffect(() => setItems(tasks), [tasks]);

  const move = async (id: string, status: BoardTask["status"]) => {
    const prev = items;
    const task = items.find((t) => t.id === id);
    if (!task || task.status === status) return;
    if (!task.canMove) return toast.error("You can only move tasks assigned to you.");
    setItems((s) => s.map((t) => (t.id === id ? { ...t, status } : t)));
    const res = await moveTask(id, status);
    if (!res?.ok) {
      setItems(prev);
      toast.error(res?.message ?? "Could not move task");
    } else {
      router.refresh();
    }
  };

  return (
    <div className="thin-scroll grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 lg:grid-flow-row lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const list = items.filter((t) => t.status === col.key);
        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (dragId) void move(dragId, col.key);
              setDragId(null);
            }}
            className={cn("flex min-h-[200px] flex-col rounded-xl border border-line bg-surface-2/60 p-2", over === col.key && "border-brand bg-brand-soft/40")}
          >
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[13px] font-semibold">{col.label}</span>
              <span className="rounded-full bg-surface px-2 text-xs text-muted">{list.length}</span>
            </div>
            <div className="mt-1 flex flex-col gap-2">
              {list.map((t) => {
                const overdue = t.dueDate && t.dueDate < today && t.status !== "DONE";
                return (
                  <article
                    key={t.id}
                    draggable={t.canMove}
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn("rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow)]", t.canMove && "cursor-grab active:cursor-grabbing", dragId === t.id && "opacity-50")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={t.project ? `/projects/${t.project.id}?tab=tasks#task-${t.id}` : "#"} className={cn("text-[13px] font-medium leading-snug hover:text-brand", t.status === "DONE" && "text-muted line-through")}>
                        {t.title}
                      </Link>
                      <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", PRIORITY[t.priority])}>{t.priority.toLowerCase()}</span>
                    </div>
                    {showProject && t.project ? <p className="mt-1 truncate text-xs text-muted">{t.project.name}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {t.dueDate ? (
                        <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-danger")}>
                          <CalendarDays className="h-3 w-3" />
                          {new Date(t.dueDate + "T00:00:00Z").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" })}
                        </span>
                      ) : null}
                      {t.subtasks ? <span className="inline-flex items-center gap-1"><ListTree className="h-3 w-3" />{t.subtasksDone}/{t.subtasks}</span> : null}
                      {t.isRecurring ? <span className="inline-flex items-center gap-1" title="Repeats monthly"><Repeat className="h-3 w-3" /></span> : null}
                      {t.assignee ? <span className="ml-auto truncate">{t.assignee}</span> : <span className="ml-auto italic">Unassigned</span>}
                    </div>
                    {t.canMove ? (
                      <select
                        aria-label={`Move “${t.title}”`}
                        value={t.status}
                        onChange={(e) => void move(t.id, e.target.value as BoardTask["status"])}
                        className="mt-2 h-7 w-full rounded-md border border-line bg-surface-2 px-2 text-xs text-muted lg:hidden"
                      >
                        {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                      </select>
                    ) : null}
                  </article>
                );
              })}
              {!list.length ? <p className="px-2 py-6 text-center text-xs text-subtle">Drop tasks here</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
