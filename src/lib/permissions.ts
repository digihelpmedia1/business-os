// Module-level access control. Shared by server and client (no secrets here).
// Levels are cumulative: VIEW < EDIT (create / update) < FULL (delete, cancel, approve, configure).

export const ACCESS_LEVELS = ["NONE", "VIEW", "EDIT", "FULL"] as const;
export type Level = (typeof ACCESS_LEVELS)[number];

export const LEVEL_LABELS: Record<Level, { label: string; help: string }> = {
  NONE: { label: "No access", help: "Module is hidden" },
  VIEW: { label: "View", help: "Can see records" },
  EDIT: { label: "Edit", help: "Can create and update" },
  FULL: { label: "Full", help: "Can also delete, cancel and approve" },
};

export const MODULES = [
  { key: "dashboard", label: "Overview Dashboard", description: "Company-wide KPIs, charts and alerts" },
  { key: "billing", label: "Documents & Billing", description: "Clients, proposals, quotations, invoices, payments" },
  { key: "finance", label: "Finance & Accounting", description: "Transactions, accounts, financial statements" },
  { key: "projects", label: "Projects & Operations", description: "Projects, tasks, milestones, time tracking" },
  { key: "intelligence", label: "Business Intelligence", description: "Metrics, profitability, forecasts" },
  { key: "vendors", label: "Expenses & Vendors", description: "Vendors, purchase bills, vendor payments" },
  { key: "assets", label: "Subscriptions & Assets", description: "Software subscriptions, domains, company assets" },
  { key: "planning", label: "Planning & Goals", description: "Targets, budgets, actual vs planned" },
  { key: "team", label: "Employee Management", description: "Employees, freelancers, attendance, leave, payroll" },
  { key: "reports", label: "Reports & Analytics", description: "Exportable financial and operational reports" },
  { key: "vault", label: "Document Vault", description: "Company documents and file storage" },
  { key: "assistant", label: "AI Business Assistant", description: "Ask questions about business data" },
  { key: "settings", label: "Settings", description: "Company profile, GST, numbering, templates, integrations" },
  { key: "users", label: "Users & Access", description: "User accounts, roles, access levels, audit log" },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export type AccessMap = Record<ModuleKey, Level>;

export function levelRank(level: Level | undefined | null): number {
  return ACCESS_LEVELS.indexOf(level ?? "NONE");
}

export function can(access: Partial<AccessMap> | undefined, module: ModuleKey, needed: Level = "VIEW"): boolean {
  if (!access) return false;
  return levelRank(access[module]) >= levelRank(needed);
}

export function emptyAccess(level: Level = "NONE"): AccessMap {
  return Object.fromEntries(MODULES.map((m) => [m.key, level])) as AccessMap;
}

/** Preset roles created on first setup. Admins can edit them or create custom roles. */
export const PRESET_ROLES: { name: string; description: string; isSystem?: boolean; access: Partial<AccessMap> }[] = [
  {
    name: "Admin",
    description: "Owner / administrator — full control of every module, users and settings.",
    isSystem: true,
    access: emptyAccess("FULL"),
  },
  {
    name: "Manager",
    description: "Runs day-to-day operations and finance. Cannot manage users or access levels.",
    access: {
      dashboard: "VIEW", billing: "FULL", finance: "FULL", projects: "FULL", intelligence: "VIEW", vendors: "FULL",
      assets: "FULL", planning: "FULL", team: "EDIT", reports: "VIEW", vault: "FULL", assistant: "VIEW", settings: "VIEW",
    },
  },
  {
    name: "Accountant",
    description: "Billing, finance, vendors and reports. No project or HR access.",
    access: {
      dashboard: "VIEW", billing: "EDIT", finance: "EDIT", vendors: "EDIT", assets: "VIEW", planning: "VIEW",
      reports: "VIEW", intelligence: "VIEW", vault: "EDIT", assistant: "VIEW",
    },
  },
  {
    name: "Editor",
    description: "Can create and update projects, quotations, vendors and documents. No finance figures.",
    access: { billing: "EDIT", projects: "EDIT", vendors: "EDIT", assets: "VIEW", team: "VIEW", vault: "EDIT" },
  },
  {
    name: "Standard",
    description: "Team member — sees projects and documents, works on own tasks and time sheets.",
    access: { projects: "VIEW", vault: "VIEW" },
  },
];
