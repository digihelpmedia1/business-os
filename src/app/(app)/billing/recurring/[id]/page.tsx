import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate, isoDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { clientOptions } from "@/lib/options";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { RecurringForm } from "@/components/billing/recurring-form";
import { StatusBadge } from "@/components/status-badge";
import { SimpleTable } from "@/components/simple-table";
import { loadEditorData } from "@/server/services/editor-data";
import { saveRecurring } from "@/server/actions/billing";

export default async function RecurringDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess("billing", "EDIT");
  const { id } = await params;
  const p = await db.recurringInvoice.findUnique({ where: { id }, include: { invoices: { orderBy: { issueDate: "desc" }, take: 24 } } });
  if (!p) notFound();
  const [data, clients] = await Promise.all([loadEditorData(), clientOptions()]);
  const items = (p.items as Record<string, string | null>[]).map((i) => ({
    key: Math.random().toString(36).slice(2, 10), serviceId: i.serviceId ?? "", description: i.description ?? "", details: i.details ?? "", sacCode: i.sacCode ?? "",
    unit: i.unit ?? "", quantity: String(i.quantity ?? "1"), unitPrice: String(i.unitPrice ?? "0"), discountPercent: String(i.discountPercent ?? "0"), taxRate: String(Number(i.taxRate ?? 0)),
  }));
  return (
    <>
      <PageHeader breadcrumb={<Link href="/billing/recurring" className="hover:text-fg">Recurring Invoices</Link>} title={p.name} description={p.isActive ? `Next invoice on ${fmtDate(p.nextRunDate)}` : "Paused"} />
      <RecurringForm
        initial={{
          name: p.name, clientId: p.clientId, projectId: p.projectId ?? "", invoiceType: p.invoiceType, frequency: p.frequency, startDate: isoDate(p.startDate),
          endDate: isoDate(p.endDate), dueInDays: String(p.dueInDays), autoIssue: p.autoIssue, isActive: p.isActive, notes: p.notes ?? "", items,
        }}
        clients={clients}
        projects={data.projects}
        services={data.services}
        taxRates={data.taxRates}
        gstRegistered={data.company.gstRegistered}
        save={saveRecurring.bind(null, id)}
      />
      <Card className="mt-6">
        <CardHeader title="Generated invoices" />
        <SimpleTable
          head={["Invoice", "Date", "Period", "Status", "Total"]}
          rows={p.invoices.map((i) => [
            <Link key="n" href={`/billing/invoices/${i.id}`} className="text-brand">{i.number ?? "Draft"}</Link>,
            fmtDate(i.issueDate), i.periodLabel ?? "—", <StatusBadge key="s" status={i.status} />, formatMoney(i.total),
          ])}
        />
      </Card>
    </>
  );
}
