import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, FilePlus2, Pencil, ReceiptText, RotateCcw } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { D, Decimal, formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { effectiveInvoiceStatus, invoiceOutstanding } from "@/lib/finance/ledger";
import { INVOICE_TYPE_LABELS } from "@/lib/finance/constants";
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusBadge } from "@/components/status-badge";
import { archiveClient, restoreClient, saveClient } from "@/server/actions/clients";
import { clientDefaults, clientFields } from "../fields";
import { SimpleTable } from "@/components/simple-table";

export default async function ClientDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess("billing");
  const { id } = await params;
  const client = await db.client.findUnique({
    where: { id },
    include: {
      invoices: { where: { deletedAt: null }, orderBy: { issueDate: "desc" }, take: 50 },
      quotes: { where: { deletedAt: null }, orderBy: { issueDate: "desc" }, take: 20 },
      payments: { where: { voidedAt: null }, orderBy: { paymentDate: "desc" }, take: 20, include: { invoice: { select: { number: true } } } },
      projects: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!client) notFound();
  const canEdit = can(user.access, "billing", "EDIT");
  const live = client.invoices.filter((i) => ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(i.status));
  const billed = live.filter((i) => ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"].includes(i.type)).reduce((a, i) => a.plus(D(i.taxableAmount)), new Decimal(0))
    .minus(live.filter((i) => i.type === "CREDIT_NOTE").reduce((a, i) => a.plus(D(i.taxableAmount)), new Decimal(0)));
  const outstanding = live.filter((i) => ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"].includes(i.type)).reduce((a, i) => a.plus(invoiceOutstanding(i)), new Decimal(0));
  const received = client.payments.reduce((a, p) => a.plus(D(p.amount)), new Decimal(0));

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/billing/clients" className="hover:text-fg">Clients</Link>}
        title={<span className="flex items-center gap-3">{client.name} <StatusBadge status={client.deletedAt ? "INACTIVE" : client.status} label={client.deletedAt ? "Archived" : undefined} /></span>}
        description={client.businessName ?? undefined}
        actions={
          <>
            {canEdit && !client.deletedAt ? (
              <>
                <LinkButton href={`/billing/quotes/new?clientId=${client.id}`} variant="outline"><FilePlus2 /> New quotation</LinkButton>
                <LinkButton href={`/billing/invoices/new?clientId=${client.id}`} variant="outline"><ReceiptText /> New invoice</LinkButton>
                <FormDialog trigger={<><Pencil /> Edit</>} triggerVariant="outline" title="Edit client" fields={clientFields} defaults={clientDefaults(client)} action={saveClient.bind(null, client.id)} size="lg" />
              </>
            ) : null}
            {can(user.access, "billing", "FULL") ? (
              client.deletedAt ? (
                <ConfirmAction action={restoreClient.bind(null, client.id)} label={<><RotateCcw /> Restore</>} title="Restore client?" confirmVariant="primary" confirmLabel="Restore" size="md" />
              ) : (
                <ConfirmAction action={archiveClient.bind(null, client.id)} label={<><Archive /> Archive</>} title="Archive this client?" message="Archived clients are hidden from lists and pickers. Their invoices and history are kept." confirmLabel="Archive" size="md" variant="danger-ghost" />
              )
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Billed (excl. GST)" value={formatMoney(billed)} hint="Net of credit notes" />
        <StatCard label="Received" value={formatMoney(received)} hint="Cash received (excl. TDS)" />
        <StatCard label="Outstanding" value={formatMoney(outstanding)} tone={outstanding.gt(0) ? "warning" : "default"} />
        <StatCard label="Projects" value={client.projects.length} hint={`${client.projects.filter((p) => p.status === "IN_PROGRESS").length} in progress`} />
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                { label: "Contact person", value: client.contactPerson },
                { label: "Email", value: client.email ? <a href={`mailto:${client.email}`} className="text-brand">{client.email}</a> : null },
                { label: "Phone", value: client.phone },
                { label: "GSTIN", value: client.gstin ?? "Unregistered" },
                { label: "PAN", value: client.pan },
                { label: "Billing address", value: [client.billingAddress, client.city, client.state, client.pincode, client.country].filter(Boolean).join(", ") },
                { label: "Place of supply", value: client.stateCode ? `${client.stateCode} — ${client.state ?? ""}` : null },
                { label: "Client since", value: fmtDate(client.acquiredAt) },
                { label: "Acquisition channel", value: client.acquisitionChannel },
                { label: "CRM link", value: client.externalCrmId ? <span>{client.crmSource} · <span className="font-mono text-xs">{client.externalCrmId}</span><span className="block text-xs text-muted">Synced {fmtDateTime(client.crmSyncedAt)}</span></span> : "Created manually" },
                { label: "Notes", value: client.notes ? <span className="whitespace-pre-wrap">{client.notes}</span> : null },
              ]}
            />
          </CardBody>
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Invoices & notes" action={<Link href={`/billing/invoices?clientId=${client.id}`} className="text-[13px] text-brand hover:underline">All</Link>} />
            {client.invoices.length ? (
              <SimpleTable
                head={["Number", "Type", "Date", "Status", "Total", "Due"]}
                rows={client.invoices.map((i) => [
                  <Link key="n" href={`/billing/invoices/${i.id}`} className="font-medium text-brand">{i.number ?? "Draft"}</Link>,
                  INVOICE_TYPE_LABELS[i.type],
                  fmtDate(i.issueDate),
                  <StatusBadge key="s" status={effectiveInvoiceStatus(i)} />,
                  formatMoney(i.total),
                  i.type === "CREDIT_NOTE" ? "—" : formatMoney(invoiceOutstanding(i)),
                ])}
              />
            ) : (
              <EmptyState title="No invoices yet" className="py-8" />
            )}
          </Card>
          <Card>
            <CardHeader title="Proposals & quotations" />
            {client.quotes.length ? (
              <SimpleTable
                head={["Number", "Title", "Date", "Status", "Total"]}
                rows={client.quotes.map((q) => [
                  <Link key="n" href={`/billing/quotes/${q.id}`} className="font-medium text-brand">{q.number}</Link>,
                  q.title,
                  fmtDate(q.issueDate),
                  <StatusBadge key="s" status={q.status} />,
                  formatMoney(q.total),
                ])}
              />
            ) : (
              <EmptyState title="No proposals or quotations yet" className="py-8" />
            )}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Recent payments" />
              {client.payments.length ? (
                <SimpleTable head={["Receipt", "Date", "Amount"]} rows={client.payments.map((p) => [<a key="r" href={`/api/pdf/receipt/${p.id}`} className="text-brand" target="_blank">{p.receiptNumber}</a>, fmtDate(p.paymentDate), formatMoney(p.amount)])} />
              ) : (
                <EmptyState title="No payments yet" className="py-8" />
              )}
            </Card>
            <Card>
              <CardHeader title="Projects" />
              {client.projects.length ? (
                <SimpleTable head={["Project", "Status"]} rows={client.projects.map((p) => [<Link key="p" href={`/projects/${p.id}`} className="text-brand">{p.name}</Link>, <StatusBadge key="s" status={p.status} />])} />
              ) : (
                <EmptyState title="No projects" className="py-8" />
              )}
            </Card>
          </div>
        </div>
      </div>
      {client.gstin ? null : <p className="mt-4 text-xs text-muted"><Badge>Note</Badge> Unregistered client — B2C rules apply on GST invoices.</p>}
    </>
  );
}

