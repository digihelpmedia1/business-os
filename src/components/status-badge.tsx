import { Badge, type BadgeTone } from "@/components/ui/primitives";
import { titleCase } from "@/lib/utils";

const TONES: Record<string, BadgeTone> = {
  // invoices / quotes
  DRAFT: "neutral",
  ISSUED: "brand",
  SENT: "brand",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  OVERDUE: "danger",
  CANCELLED: "neutral",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "neutral",
  // bills
  UNPAID: "warning",
  // projects
  PLANNING: "info",
  NOT_STARTED: "neutral",
  IN_PROGRESS: "brand",
  ON_HOLD: "warning",
  COMPLETED: "success",
  // tasks
  TODO: "neutral",
  REVIEW: "accent",
  DONE: "success",
  PENDING: "warning",
  // priority
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
  // generic
  ACTIVE: "success",
  INACTIVE: "neutral",
  CHURNED: "danger",
  PAUSED: "warning",
  EXITED: "neutral",
  ON_LEAVE: "warning",
  APPROVED: "success",
  IN_USE: "success",
  IN_STOCK: "info",
  UNDER_REPAIR: "warning",
  RETIRED: "neutral",
  LOST: "danger",
  SOLD: "neutral",
  PRESENT: "success",
  ABSENT: "danger",
  HALF_DAY: "warning",
  WORK_FROM_HOME: "info",
  HOLIDAY: "neutral",
  INCOME: "success",
  EXPENSE: "danger",
  TRANSFER: "info",
  CRITICAL: "danger",
  WARNING: "warning",
  INFO: "info",
};

const LABELS: Record<string, string> = { WORK_FROM_HOME: "WFH", TODO: "To do" };

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{label ?? LABELS[status] ?? titleCase(status)}</Badge>;
}
