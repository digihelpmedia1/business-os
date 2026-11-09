import "server-only";
import type { FieldDef } from "@/components/ui/form-dialog";
import type { Option } from "@/lib/options";
import type { Project, Task } from "@prisma/client";
import { isoDate } from "@/lib/dates";

export const PROJECT_STATUS_OPTIONS: Option[] = [
  { value: "PLANNING", label: "Planning" }, { value: "NOT_STARTED", label: "Not started" }, { value: "IN_PROGRESS", label: "In progress" },
  { value: "ON_HOLD", label: "On hold" }, { value: "COMPLETED", label: "Completed" }, { value: "CANCELLED", label: "Cancelled" },
];

export function projectFields(o: { clients: Option[]; services: Option[]; employees: Option[] }): FieldDef[] {
  return [
    { name: "name", label: "Project name", required: true, span: 2 },
    { name: "clientId", label: "Client", type: "select", options: o.clients },
    { name: "serviceId", label: "Service", type: "select", options: o.services, hint: "Used for service-wise profitability" },
    { name: "managerId", label: "Project manager", type: "select", options: o.employees },
    { name: "code", label: "Project code", placeholder: "Optional, e.g. ACME-META" },
    { name: "status", label: "Status", type: "select", options: PROJECT_STATUS_OPTIONS, emptyOption: false },
    { name: "billingType", label: "Billing", type: "select", emptyOption: false, options: [{ value: "FIXED", label: "Fixed price" }, { value: "RETAINER", label: "Monthly retainer" }, { value: "HOURLY", label: "Hourly" }, { value: "NON_BILLABLE", label: "Internal / non-billable" }] },
    { name: "budget", label: "Budget (₹)", type: "money", hint: "Cost budget for tracking" },
    { name: "monthlyFee", label: "Monthly fee (₹)", type: "money", hint: "Retainers only" },
    { name: "startDate", label: "Start date", type: "date" },
    { name: "endDate", label: "End date", type: "date" },
    { name: "description", label: "Description & scope", type: "textarea", rows: 4 },
  ];
}

export function projectDefaults(p?: Project | null) {
  if (!p) return { status: "PLANNING", billingType: "FIXED" };
  return {
    name: p.name, code: p.code, clientId: p.clientId, serviceId: p.serviceId, managerId: p.managerId, status: p.status, billingType: p.billingType,
    budget: p.budget?.toFixed(2), monthlyFee: p.monthlyFee?.toFixed(2), startDate: isoDate(p.startDate), endDate: isoDate(p.endDate), description: p.description,
  };
}

export function taskFields(o: { projects?: Option[]; employees: Option[]; parents?: Option[] }): FieldDef[] {
  return [
    ...(o.projects ? [{ name: "projectId", label: "Project", type: "select", options: o.projects, required: true, span: 2 } as FieldDef] : [{ name: "projectId", label: "", type: "hidden" } as FieldDef]),
    { name: "title", label: "Title", required: true, span: 2 },
    { name: "status", label: "Status", type: "select", emptyOption: false, options: [{ value: "TODO", label: "To do" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "REVIEW", label: "Review" }, { value: "DONE", label: "Done" }] },
    { name: "priority", label: "Priority", type: "select", emptyOption: false, options: [{ value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" }] },
    { name: "assigneeId", label: "Assignee", type: "select", options: o.employees },
    ...(o.parents ? [{ name: "parentId", label: "Subtask of", type: "select", options: o.parents, emptyOption: "— Top-level task —" } as FieldDef] : []),
    { name: "startDate", label: "Start date", type: "date" },
    { name: "dueDate", label: "Due date", type: "date" },
    { name: "estimateHours", label: "Estimate (hours)", type: "number", step: "0.25" },
    { name: "isRecurring", label: "Repeats monthly (retainer task)", type: "checkbox" },
    { name: "description", label: "Description", type: "textarea" },
  ];
}

export function taskDefaults(t: Task) {
  return {
    projectId: t.projectId, parentId: t.parentId, title: t.title, status: t.status, priority: t.priority, assigneeId: t.assigneeId,
    startDate: isoDate(t.startDate), dueDate: isoDate(t.dueDate), estimateHours: t.estimateHours?.toString(), isRecurring: t.isRecurring, description: t.description,
  };
}
