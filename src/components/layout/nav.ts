import type { ModuleKey } from "@/lib/permissions";

export type NavItem = { href: string; label: string };
export type NavGroup = {
  key: string;
  label: string;
  icon: string;
  module: ModuleKey | null; // null = every signed-in user
  href?: string;
  items?: NavItem[];
};

export const NAV: NavGroup[] = [
  { key: "dashboard", label: "Overview Dashboard", icon: "LayoutDashboard", module: "dashboard", href: "/dashboard" },
  { key: "my-work", label: "My Work", icon: "CircleCheck", module: null, href: "/my-work" },
  {
    key: "billing",
    label: "Documents & Billing",
    icon: "FileText",
    module: "billing",
    items: [
      { href: "/billing/clients", label: "Clients" },
      { href: "/billing/quotes", label: "Proposals & Quotations" },
      { href: "/billing/invoices", label: "Invoices & Notes" },
      { href: "/billing/payments", label: "Payments & Receipts" },
      { href: "/billing/recurring", label: "Recurring Invoices" },
    ],
  },
  {
    key: "finance",
    label: "Finance & Accounting",
    icon: "Landmark",
    module: "finance",
    items: [
      { href: "/finance/transactions", label: "Transactions" },
      { href: "/finance/accounts", label: "Bank & Cash Accounts" },
      { href: "/finance/categories", label: "Categories" },
      { href: "/finance/statements", label: "Financial Statements" },
    ],
  },
  {
    key: "projects",
    label: "Projects & Operations",
    icon: "KanbanSquare",
    module: "projects",
    items: [
      { href: "/projects", label: "Projects" },
      { href: "/projects/tasks", label: "Tasks Board" },
      { href: "/projects/calendar", label: "Calendar" },
      { href: "/projects/time", label: "Time Tracking" },
    ],
  },
  { key: "intelligence", label: "Business Intelligence", icon: "BrainCircuit", module: "intelligence", href: "/intelligence" },
  {
    key: "vendors",
    label: "Expenses & Vendors",
    icon: "Truck",
    module: "vendors",
    items: [
      { href: "/vendors", label: "Vendors" },
      { href: "/vendors/bills", label: "Purchase Bills" },
    ],
  },
  {
    key: "assets",
    label: "Subscriptions & Assets",
    icon: "Package",
    module: "assets",
    items: [
      { href: "/subscriptions", label: "Subscriptions & Domains" },
      { href: "/assets", label: "Company Assets" },
    ],
  },
  { key: "planning", label: "Planning & Goals", icon: "Target", module: "planning", href: "/planning" },
  {
    key: "team",
    label: "Employee Management",
    icon: "Users",
    module: "team",
    items: [
      { href: "/team", label: "Employees & Freelancers" },
      { href: "/team/attendance", label: "Attendance" },
      { href: "/team/leave", label: "Leave" },
      { href: "/team/payroll", label: "Payroll & Payouts" },
    ],
  },
  { key: "reports", label: "Reports & Analytics", icon: "BarChart3", module: "reports", href: "/reports" },
  { key: "vault", label: "Document Vault", icon: "FolderLock", module: "vault", href: "/vault" },
  { key: "assistant", label: "AI Assistant", icon: "Sparkles", module: "assistant", href: "/assistant" },
  { key: "notifications", label: "Notifications", icon: "Bell", module: null, href: "/notifications" },
  {
    key: "settings",
    label: "Settings",
    icon: "Settings",
    module: "settings",
    items: [
      { href: "/settings", label: "Company & GST" },
      { href: "/settings/numbering", label: "Document Numbering" },
      { href: "/settings/taxes", label: "Tax Rates" },
      { href: "/settings/services", label: "Services Catalog" },
      { href: "/settings/templates", label: "Document Templates" },
      { href: "/settings/currencies", label: "Currencies" },
      { href: "/settings/integrations", label: "Integrations & API" },
      { href: "/settings/backup", label: "Data Export & Backup" },
    ],
  },
  {
    key: "users",
    label: "Users & Access",
    icon: "ShieldCheck",
    module: "users",
    items: [
      { href: "/settings/users", label: "Users" },
      { href: "/settings/roles", label: "Roles & Access Levels" },
      { href: "/settings/audit", label: "Audit Log" },
    ],
  },
];
