import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, BellRing, Download, FileMinus2, FilePlus2, Pencil, Repeat, Send, Trash2, Wallet } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDate, fmtDateTime, isoDate, todayIST } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { accountOptions, PAYMENT_METHOD_OPTIONS } from "@/lib/options";
import { effectiveInvoiceStatus, invoiceOutstanding } from "@/lib/finance/ledger";
import { INVOICE_TYPE_LABELS } from "@/lib/finance/constants";
import { Card, CardBody, CardHeader, PageHeader, Notice, EmptyState } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormDialog } from "@/components/ui/form-dialog";
import { PrintButton } from "@/components/ui/client-buttons";
import { StatusBadge } from "@/components/status-badge";
import { DocPreview } from "@/components/billing/doc-preview";
import { invoicePreview } from "@/server/services/doc-models";
import { cancelInvoiceAction, convertAdvanceAction, deleteDraftInvoice, issueInvoiceAction, markReminderSent, recordPaymentAction, voidPaymentAction } from "@/server/actions/billing";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess("billing");
  const { id } = await params;
  const inv = await db.invoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      client: true,
      project: true,
      relatedInvoice: true,
      adjustments: { where: { deletedAt: null }, orderBy: { issueDate: "asc" } },
      payments: { orderBy: { paymentDate: "asc" }, include: { account: true } },
      sourceQuote: { select: { id: true, number: true } },
      recurringProfile: { select: { id: true, name: true } },
    },
  });
  if (!inv || inv.deletedAt) notFound();
  const [settings, accounts, history] = await Promise.all([
    getSettings(),
    accountOptions(),
    db.auditLog.findMany({ where: { entityId: id }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const today = todayIST();
  const status = effectiveInvoiceStatus(inv, today);
  const outstanding = invoiceOutstanding(inv);
  const canEdit = can(user.access, "billing", "EDIT");
  const canFull = can(user.access, "billing", "FULL");
  const isNote = inv.type === "CREDIT_NOTE" || inv.type === "DEBIT_NOTE";
  const payable = ["ISSUED", "PARTIALLY_PAID"].includes(inv.status) && inv.type !== "CREDIT_NOTE";
  const reminderText = `Hello ${inv.client.contactPerson || inv.client.name}, a gentle reminder that invoice ${inv.number} for ${formatMoney(inv.total)} ${inv.dueDate ? `was due on ${fmtDate(inv.dueDate)}` : "is pending"}. Outstanding: ${formatMoney(outstanding)}. Thank you — ${settings.companyName}`;
  const waPhone = inv.client.phone?.replace(/[^\d]/g, "");

  return (
    <>
      <div className="no-print">
        <PageHeader
          breadcrumb={<Link href="/billing/invoices" className="hover:text-fg">Invoices & Notes</Link>}
          title={<span className="flex flex-wrap items-center gap-3">{inv.number ?? "Draft"} <StatusBadge status={status} /></span>}
          description={`${INVOICE_TYPE_LABELS[inv.type]} · ${inv.clientName ?? inv.client.name} · ${formatMoney(inv.total)}`}
          actions={
            <>
              <LinkButton href={`/api/pdf/invoice/${inv.id}`} variant="outline" target="_blank"><Download /> PDF</LinkButton>
              <PrintButton />
              {canEdit && inv.status === "DRAFT" ? (
                <>
                  <LinkButton href={`/billing/invoices/${inv.id}/edit`} variant="outline"><Pencil /> Edit</LinkButton>
                  <ConfirmAction action={issueInvoiceAction.bind(null, inv.id)} label={<><Send /> Issue</>} title="Issue this document?" message="A permanent number will be assigned from your series. Issued documents can't be edited — adjust them with credit/debit notes." confirmVariant="primary" confirmLabel="Issue" variant="primary" size="md" />
                </>
              ) : null}
            </>
          }
        />
        {status === "OVERDUE" ? <Notice tone="danger" className="mb-4">Overdue since {fmtDate(inv.dueDate)} — {formatMoney(outstanding)} outstanding.{inv.lastReminderAt ? ` Last reminder: ${fmtDateTime(inv.lastReminderAt)}.` : ""}</Notice> : null}
        {inv.status === "CANCELLED" ? <Notice tone="warning" className="mb-4">Cancelled on {fmtDateTime(inv.cancelledAt)} — {inv.cancelReason}</Notice> : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <DocPreview doc={invoicePreview(inv, settings)} company={settings} logoUrl={settings.logoFileId ? "/api/public/logo" : null} />
        <div className="no-print space-y-4">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="space-y-2 text-[13px]">
              <Line label="Total" value={formatMoney(inv.total)} />
              {!isNote || inv.type === "DEBIT_NOTE" ? (
                <>
                  <Line label="Received (incl. TDS)" value={formatMoney(inv.amountPaid)} />
                  <Line label="Credit notes" value={formatMoney(inv.amountCredited)} />
                  <Line label="Balance due" value={formatMoney(outstanding)} strong />
                </>
              ) : null}
              {inv.relatedInvoice ? <Line label="Against" value={<Link href={`/billing/invoices/${inv.relatedInvoice.id}`} className="text-brand">{inv.relatedInvoice.number}</Link>} /> : null}
              {inv.project ? <Line label="Project" value={<Link href={`/projects/${inv.project.id}`} className="text-brand">{inv.project.name}</Link>} /> : null}
              {inv.sourceQuote ? <Line label="From" value={<Link href={`/billing/quotes/${inv.sourceQuote.id}`} className="text-brand">{inv.sourceQuote.number}</Link>} /> : null}
              {inv.recurringProfile ? <Line label="Recurring" value={<Link href={`/billing/recurring/${inv.recurringProfile.id}`} className="text-brand">{inv.recurringProfile.name}</Link>} /> : null}
            </CardBody>
            {canEdit && inv.status !== "DRAFT" && inv.status !== "CANCELLED" ? (
              <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
                {payable ? (
                  <FormDialog
                    trigger={<><Wallet /> Record payment</>}
                    triggerSize="sm"
                    title={`Record payment — ${inv.number}`}
                    description={`Outstanding: ${formatMoney(outstanding)}. A receipt and a linked income transaction are created automatically.`}
                    action={recordPaymentAction.bind(null, inv.id)}
                    submitLabel="Record payment"
                    defaults={{ paymentDate: isoDate(today), amount: outstanding.toFixed(2), tdsAmount: "0", method: "BANK_TRANSFER", accountId: accounts[0]?.value }}
                    fields={[
                      { name: "paymentDate", label: "Payment date", type: "date", required: true },
                      { name: "amount", label: "Amount received (₹)", type: "money", required: true },
                      { name: "tdsAmount", label: "TDS deducted by client (₹)", type: "money", hint: "Settles the invoice without cash; tracked as TDS receivable" },
                      { name: "method", label: "Method", type: "select", options: PAYMENT_METHOD_OPTIONS, emptyOption: false },
                      { name: "accountId", label: "Received in account", type: "select", options: accounts, required: true, hint: accounts.length ? undefined : "Add an account in Finance → Bank & Cash Accounts first" },
                      { name: "reference", label: "Reference / UTR" },
                      { name: "notes", label: "Notes", type: "textarea" },
                    ]}
                  />
                ) : null}
                {["TAX_INVOICE", "NON_GST"].includes(inv.type) ? (
                  <>
                    <LinkButton href={`/billing/invoices/new?type=CREDIT_NOTE&relatedInvoiceId=${inv.id}`} variant="outline" size="sm"><FileMinus2 /> Credit note</LinkButton>
                    <LinkButton href={`/billing/invoices/new?type=DEBIT_NOTE&relatedInvoiceId=${inv.id}`} variant="outline" size="sm"><FilePlus2 /> Debit note</LinkButton>
                  </>
                ) : null}
                {["PROFORMA", "ADVANCE"].includes(inv.type) ? (
                  <ConfirmAction action={convertAdvanceAction.bind(null, inv.id)} label={<><Repeat /> Convert to final invoice</>} title="Convert to a final invoice?" message="A new invoice is issued with the same items; payments received move to it and this document is closed." confirmVariant="primary" confirmLabel="Convert" variant="outline" />
                ) : null}
              </div>
            ) : null}
          </Card>
          {payable ? (
            <Card>
              <CardHeader title="Payment reminder" description="Send via email or WhatsApp, then log it." />
              <CardBody className="flex flex-wrap gap-2">
                {inv.client.email ? <LinkButton href={`mailto:${inv.client.email}?subject=${encodeURIComponent(`Payment reminder: ${inv.number}`)}&body=${encodeURIComponent(reminderText)}`} variant="outline" size="sm">Email</LinkButton> : null}
                {waPhone ? <LinkButton href={`https://wa.me/${waPhone.length === 10 ? "91" + waPhone : waPhone}?text=${encodeURIComponent(reminderText)}`} variant="outline" size="sm" target="_blank">WhatsApp</LinkButton> : null}
                <ConfirmAction action={markReminderSent.bind(null, inv.id)} label={<><BellRing /> Log reminder</>} noConfirm />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Payments & receipts" />
            {inv.payments.length ? (
              <ul className="divide-y divide-line">
                {inv.payments.map((p) => (
                  <li key={p.id} className="px-5 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <a href={`/api/pdf/receipt/${p.id}`} target="_blank" className={`font-medium ${p.voidedAt ? "text-muted line-through" : "text-brand"}`}>{p.receiptNumber}</a>
                      <span className="tabular font-medium">{formatMoney(p.amount)}</span>
                    </div>
                    <p className="text-xs text-muted">
                      {fmtDate(p.paymentDate)} · {p.method.replace(/_/g, " ").toLowerCase()} · {p.account.name}
                      {p.tdsAmount.gt(0) ? ` · TDS ${formatMoney(p.tdsAmount)}` : ""}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                    {p.voidedAt ? <p className="text-xs text-danger">Voided: {p.voidReason}</p> : canFull ? (
                      <div className="mt-1"><ConfirmAction action={voidPaymentAction.bind(null, p.id)} label="Void" size="sm" variant="ghost" title="Void this payment?" message="The linked income transaction is removed and the invoice balance restored." reasonLabel="Reason" reasonRequired confirmLabel="Void payment" /></div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No payments recorded" className="py-6" />
            )}
          </Card>
          {inv.adjustments.length ? (
            <Card>
              <CardHeader title="Credit & debit notes" />
              <ul className="divide-y divide-line">
                {inv.adjustments.map((a) => (
                  <li key={a.id}>
                    <Link href={`/billing/invoices/${a.id}`} className="flex items-center justify-between px-5 py-2.5 text-[13px] hover:bg-surface-2">
                      <span>{a.number ?? "Draft"} <span className="text-xs text-muted">· {INVOICE_TYPE_LABELS[a.type]}</span></span>
                      <span className="flex items-center gap-2"><StatusBadge status={a.status} /> {formatMoney(a.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="History" />
            <ul className="space-y-3 px-5 py-4">
              {history.map((h) => (
                <li key={h.id} className="text-[13px]">
                  <p>{h.summary}</p>
                  <p className="text-xs text-muted">{h.user?.name ?? "System"} · {fmtDateTime(h.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              {inv.status === "DRAFT" ? (
                <ConfirmAction action={deleteDraftInvoice.bind(null, inv.id)} label={<><Trash2 /> Delete draft</>} title="Delete this draft?" confirmLabel="Delete" variant="danger-ghost" />
              ) : canFull && inv.status !== "CANCELLED" ? (
                <ConfirmAction action={cancelInvoiceAction.bind(null, inv.id)} label={<><Ban /> Cancel invoice</>} title={`Cancel ${inv.number}?`} message="The number stays used (series remain gap-free). Void payments first if any were recorded." reasonLabel="Reason for cancellation" reasonRequired confirmLabel="Cancel invoice" variant="danger-ghost" />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${strong ? "border-t border-line pt-2 font-semibold" : ""}`}>
      <span className="text-muted">{label}</span>
      <span className="tabular text-right">{value}</span>
    </div>
  );
}
