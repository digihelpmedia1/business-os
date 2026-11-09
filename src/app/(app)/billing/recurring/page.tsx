import Link from "next/link";
import { Pause, Play, Plus, RefreshCw, Trash2, Zap } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDate } from "@/lib/dates";
import { D, Decimal, formatMoney } from "@/lib/money";
import { monthlyFactor } from "@/lib/finance/engine";
import { PageHeader, StatCard, EmptyState, Card, Badge } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusBadge } from "@/components/status-badge";
import { deleteRecurring, runRecurringNow, toggleRecurring } from "@/server/actions/billing";

export const metadata = { title: "Recurring Invoices" };

function taxable(items: unknown) {
  return ((Array.isArray(items) ? items : []) as Record<string, string>[]).reduce((a, i) => {
    const sub = D(i.quantity).times(D(i.unitPrice));
    return a.plus(sub.minus(sub.times(D(i.discountPercent)).dividedBy(100)));
  }, new Decimal(0));
}

export default async function RecurringPage() {
  const user = await requirePageAccess("billing");
  const profiles = await db.recurringInvoice.findMany({
    include: { client: { select: { name: true } }, project: { select: { id: true, name: true } }, _count: { select: { invoices: true } } },
    orderBy: [{ isActive: "desc" }, { nextRunDate: "asc" }],
  });
  const mrr = profiles.filter((p) => p.isActive).reduce((a, p) => a.plus(taxable(p.items).times(monthlyFactor(p.frequency))), new Decimal(0));
  const canEdit = can(user.access, "billing", "EDIT");
  return (
    <>
      <PageHeader
        title="Recurring Invoices"
        description="Monthly retainers and other repeating invoices. Invoices are generated on schedule (daily job) as drafts or issued automatically."
        actions={
          canEdit ? (
            <>
              <ConfirmAction action={runRecurringNow} label={<><Zap /> Run due now</>} noConfirm variant="outline" size="md" />
              <LinkButton href="/billing/recurring/new"><Plus /> New profile</LinkButton>
            </>
          ) : null
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Monthly Recurring Revenue" value={formatMoney(mrr)} hint="Active profiles, excl. GST, monthly-normalised" />
        <StatCard label="Annual Recurring Revenue" value={formatMoney(mrr.times(12))} />
        <StatCard label="Active profiles" value={profiles.filter((p) => p.isActive).length} hint={`${profiles.length} total`} />
      </div>
      <Card className="overflow-hidden">
        {profiles.length ? (
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-muted">
                <th className="px-4 py-2.5">Profile</th><th className="px-4 py-2.5">Client</th><th className="px-4 py-2.5">Frequency</th><th className="px-4 py-2.5">Next invoice</th><th className="px-4 py-2.5">Generated</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Amount (excl. GST)</th><th className="px-4 py-2.5" />
              </tr></thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3"><Link href={`/billing/recurring/${p.id}`} className="font-medium hover:text-brand">{p.name}</Link>{p.project ? <span className="block text-xs text-muted">{p.project.name}</span> : null}</td>
                    <td className="px-4 py-3">{p.client.name}</td>
                    <td className="px-4 py-3">{p.frequency.replace("_", "-").toLowerCase()} {p.autoIssue ? <Badge tone="info">Auto-issue</Badge> : <Badge>Draft</Badge>}</td>
                    <td className="px-4 py-3">{p.isActive ? fmtDate(p.nextRunDate) : "—"}{p.endDate ? <span className="block text-xs text-muted">Ends {fmtDate(p.endDate)}</span> : null}</td>
                    <td className="px-4 py-3"><Link href={`/billing/invoices?q=&recurring=${p.id}`} className="text-muted">{p._count.invoices} invoice(s)</Link></td>
                    <td className="px-4 py-3"><StatusBadge status={p.isActive ? "ACTIVE" : "PAUSED"} /></td>
                    <td className="tabular px-4 py-3 text-right font-medium">{formatMoney(taxable(p.items))}</td>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <div className="flex justify-end gap-1">
                          <ConfirmAction action={toggleRecurring.bind(null, p.id, !p.isActive)} label={p.isActive ? <Pause /> : <Play />} noConfirm variant="ghost" size="icon-sm" />
                          {can(user.access, "billing", "FULL") ? <ConfirmAction action={deleteRecurring.bind(null, p.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete this profile?" message={p._count.invoices ? "It has generated invoices, so it will be ended and kept for history." : "This cannot be undone."} confirmLabel="Delete" /> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<RefreshCw />} title="No recurring invoices" description="Set up a profile for each retainer client — invoices will be generated automatically every period." action={canEdit ? <LinkButton href="/billing/recurring/new"><Plus /> New profile</LinkButton> : undefined} />
        )}
      </Card>
    </>
  );
}
