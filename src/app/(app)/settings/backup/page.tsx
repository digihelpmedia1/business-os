import { Database, Download, FileSpreadsheet } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/dates";
import { Card, CardBody, CardHeader, Notice, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Data Export & Backup" };

const CSV_EXPORTS: { key: string; label: string; module: Parameters<typeof can>[1] }[] = [
  { key: "clients", label: "Clients", module: "billing" }, { key: "quotes", label: "Proposals & quotations", module: "billing" },
  { key: "invoices", label: "Invoices & notes (with GST split)", module: "billing" }, { key: "payments", label: "Payments & receipts", module: "billing" },
  { key: "transactions", label: "All transactions", module: "finance" }, { key: "pnl?range=this_fy", label: "P&L — this FY", module: "finance" },
  { key: "cashflow?range=this_fy", label: "Cash flow — this FY", module: "finance" }, { key: "balance", label: "Balance sheet — today", module: "finance" },
  { key: "monthly?range=this_fy", label: "Monthly summary — this FY", module: "finance" }, { key: "receivables", label: "Receivables ageing", module: "finance" },
  { key: "payables", label: "Payables ageing", module: "finance" }, { key: "vendors", label: "Vendors", module: "vendors" },
  { key: "bills", label: "Purchase bills", module: "vendors" }, { key: "projects", label: "Projects & profitability", module: "projects" },
  { key: "time?range=this_fy", label: "Timesheet — this FY", module: "projects" }, { key: "employees", label: "Team", module: "team" },
  { key: "subscriptions", label: "Subscriptions", module: "assets" }, { key: "assets", label: "Asset register", module: "assets" },
  { key: "metrics?range=this_fy", label: "BI metrics — this FY", module: "intelligence" },
];

export default async function BackupPage() {
  const user = await requirePageAccess("settings");
  const lastExports = await db.auditLog.findMany({ where: { action: "EXPORT" }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 8 });
  const counts = await Promise.all([db.client.count(), db.invoice.count(), db.transaction.count(), db.project.count(), db.document.count()]);
  return (
    <>
      <PageHeader title="Data Export & Backup" description="Your data is yours: export everything at any time, in open formats." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Full data export (JSON)" description="Every table — clients, documents, finance, projects, people, settings and the audit log — in one file." />
          <CardBody className="space-y-3 text-[13px]">
            <p className="text-muted">Currently {counts[0]} clients, {counts[1]} invoices, {counts[2]} transactions, {counts[3]} projects and {counts[4]} documents. Passwords, API keys, webhook secrets and file contents are excluded for safety (download files from the Document Vault).</p>
            {can(user.access, "settings", "FULL") ? <LinkButton href="/api/backup"><Database /> Download full export</LinkButton> : <Notice>Full access to Settings is required.</Notice>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Database backups" />
          <CardBody className="space-y-2 text-[13px] text-muted">
            <p>The production database is PostgreSQL. Managed providers (Supabase, Neon, Vercel Postgres) take automatic daily backups with point-in-time restore — keep that enabled.</p>
            <p>For an extra off-site copy, run on any machine with PostgreSQL client tools:</p>
            <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-xs text-fg">pg_dump &quot;$DIRECT_URL&quot; --format=custom --file=dhm-$(date +%F).dump</pre>
            <p>Restore with <code>pg_restore --clean --dbname &quot;$DIRECT_URL&quot; file.dump</code>. See DEPLOYMENT.md in the repository.</p>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Spreadsheet exports (CSV)" description="Open in Excel or Google Sheets. More date ranges are available in Reports & Analytics." />
        <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CSV_EXPORTS.filter((e) => can(user.access, e.module)).map((e) => (
            <a key={e.key} href={`/api/export/${e.key}`} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-[13px] hover:bg-surface-2">
              <FileSpreadsheet className="h-4 w-4 text-brand" /> <span className="flex-1">{e.label}</span> <Download className="h-3.5 w-3.5 text-muted" />
            </a>
          ))}
        </CardBody>
      </Card>
      <Card className="mt-4">
        <CardHeader title="Recent exports" />
        <ul className="divide-y divide-line">
          {lastExports.length ? lastExports.map((l) => <li key={l.id} className="flex justify-between px-5 py-2.5 text-[13px]"><span>{l.summary}</span><span className="text-xs text-muted">{l.user?.name} · {fmtDateTime(l.createdAt)}</span></li>) : <li className="px-5 py-6 text-center text-[13px] text-muted">No exports yet.</li>}
        </ul>
      </Card>
    </>
  );
}
