import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Copy, Download, FileStack, Link2, Pencil, ReceiptText, Send, Trash2, Undo2, X } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { Card, CardBody, CardHeader, PageHeader, Notice } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CopyButton, PrintButton } from "@/components/ui/client-buttons";
import { StatusBadge } from "@/components/status-badge";
import { DocPreview } from "@/components/billing/doc-preview";
import { quotePreview } from "@/server/services/doc-models";
import { changeQuoteStatus, copyQuote, deleteQuote, quoteToInvoice, toggleQuoteShare } from "@/server/actions/billing";

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess("billing");
  const { id } = await params;
  const q = await db.quote.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } }, client: true, project: true, convertedInvoice: true, nextVersion: true, createdBy: { select: { name: true } } },
  });
  if (!q || q.deletedAt) notFound();
  const settings = await getSettings();
  const rootId = q.rootId ?? q.id;
  const [versions, history] = await Promise.all([
    db.quote.findMany({ where: { OR: [{ id: rootId }, { rootId }], deletedAt: null }, orderBy: { version: "asc" }, select: { id: true, number: true, version: true, status: true, total: true, issueDate: true } }),
    db.auditLog.findMany({ where: { entityType: "Quote", entityId: { in: [q.id] } }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const canEdit = can(user.access, "billing", "EDIT");
  const locked = !!q.convertedInvoiceId;
  const appUrl = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const shareUrl = q.shareToken ? `${appUrl}/share/quote/${q.shareToken}` : null;
  const logoUrl = settings.logoFileId ? "/api/public/logo" : null;

  return (
    <>
      <div className="no-print">
        <PageHeader
          breadcrumb={<Link href="/billing/quotes" className="hover:text-fg">Proposals & Quotations</Link>}
          title={<span className="flex flex-wrap items-center gap-3">{q.title} <StatusBadge status={q.status} /></span>}
          description={`${q.number} · ${q.client.name} · ${formatMoney(q.total)}${q.createdBy ? ` · created by ${q.createdBy.name}` : ""}`}
          actions={
            <>
              <LinkButton href={`/api/pdf/quote/${q.id}`} variant="outline" target="_blank"><Download /> PDF</LinkButton>
              <PrintButton />
              {canEdit && q.status === "DRAFT" ? <LinkButton href={`/billing/quotes/${q.id}/edit`}><Pencil /> Edit</LinkButton> : null}
            </>
          }
        />
        {locked ? (
          <Notice tone="success" className="mb-4">
            Converted to invoice{" "}
            <Link href={`/billing/invoices/${q.convertedInvoiceId}`} className="font-medium text-brand underline">
              {q.convertedInvoice?.number ?? "draft"}
            </Link>
            . This document is now locked.
          </Notice>
        ) : null}
        {q.nextVersion ? (
          <Notice tone="info" className="mb-4">
            A newer version exists: <Link href={`/billing/quotes/${q.nextVersion.id}`} className="font-medium text-brand underline">{q.nextVersion.number}</Link>
          </Notice>
        ) : null}
        {canEdit && !locked ? (
          <Card className="mb-4">
            <CardBody className="flex flex-wrap items-center gap-2 py-3">
              {q.status === "DRAFT" ? <ConfirmAction action={changeQuoteStatus.bind(null, q.id, "SENT")} label={<><Send /> Mark as sent</>} noConfirm variant="primary" size="md" /> : null}
              {["DRAFT", "SENT"].includes(q.status) ? (
                <>
                  <ConfirmAction action={changeQuoteStatus.bind(null, q.id, "ACCEPTED")} label={<><Check /> Accepted</>} title="Mark as accepted?" message="The client accepted this document. You can then convert it into an invoice." confirmVariant="primary" confirmLabel="Mark accepted" size="md" />
                  <ConfirmAction action={changeQuoteStatus.bind(null, q.id, "REJECTED")} label={<><X /> Rejected</>} title="Mark as rejected?" confirmLabel="Mark rejected" size="md" />
                </>
              ) : null}
              {q.status === "SENT" ? <ConfirmAction action={changeQuoteStatus.bind(null, q.id, "DRAFT")} label={<><Undo2 /> Back to draft</>} noConfirm size="md" variant="ghost" /> : null}
              {["ACCEPTED", "REJECTED", "EXPIRED"].includes(q.status) ? <ConfirmAction action={changeQuoteStatus.bind(null, q.id, "SENT")} label={<><Undo2 /> Reopen</>} noConfirm size="md" variant="ghost" /> : null}
              {q.status === "ACCEPTED" ? (
                <ConfirmAction action={quoteToInvoice.bind(null, q.id)} label={<><ReceiptText /> Convert to invoice</>} title="Create an invoice from this document?" message="A draft invoice will be created with the same line items. Review and issue it from the invoice page." confirmVariant="primary" confirmLabel="Create draft invoice" variant="accent" size="md" />
              ) : null}
              <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
              {q.status !== "DRAFT" && !q.nextVersion ? (
                <ConfirmAction action={copyQuote.bind(null, q.id, true)} label={<><FileStack /> New version</>} title="Create a new version?" message={`Version ${q.version + 1} will be created as a draft. This version stays in the history.`} confirmVariant="primary" confirmLabel="Create version" size="md" />
              ) : null}
              <ConfirmAction action={copyQuote.bind(null, q.id, false)} label={<><Copy /> Duplicate</>} title="Duplicate as a new document?" confirmVariant="primary" confirmLabel="Duplicate" size="md" />
              {can(user.access, "billing", "FULL") ? (
                <ConfirmAction action={deleteQuote.bind(null, q.id)} label={<><Trash2 /> Delete</>} title="Delete this document?" message="It will be removed from lists and its share link disabled." confirmLabel="Delete" size="md" variant="danger-ghost" />
              ) : null}
            </CardBody>
          </Card>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <DocPreview doc={quotePreview(q)} company={settings} logoUrl={logoUrl} />
        <div className="no-print space-y-4">
          <Card>
            <CardHeader title="Shareable link" description="Anyone with the link can view and download this document." />
            <CardBody className="space-y-3">
              {shareUrl ? (
                <>
                  <p className="break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">{shareUrl}</p>
                  <div className="flex gap-2">
                    <CopyButton text={shareUrl} label="Copy link" />
                    {canEdit ? <ConfirmAction action={toggleQuoteShare.bind(null, q.id, false)} label="Revoke" title="Revoke share link?" message="The current link will stop working." confirmLabel="Revoke" /> : null}
                  </div>
                </>
              ) : canEdit ? (
                <ConfirmAction action={toggleQuoteShare.bind(null, q.id, true)} label={<><Link2 /> Create share link</>} noConfirm variant="outline" />
              ) : (
                <p className="text-[13px] text-muted">No share link.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Versions" />
            <ul className="divide-y divide-line">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link href={`/billing/quotes/${v.id}`} className={`flex items-center justify-between px-5 py-2.5 text-[13px] hover:bg-surface-2 ${v.id === q.id ? "bg-brand-soft/50" : ""}`}>
                    <span><span className="font-medium">v{v.version}</span> · {fmtDate(v.issueDate)}</span>
                    <span className="flex items-center gap-2"><StatusBadge status={v.status} /><span className="tabular">{formatMoney(v.total)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <ul className="space-y-3 px-5 py-4">
              {history.length ? history.map((h) => (
                <li key={h.id} className="text-[13px]">
                  <p className="text-fg">{h.summary}</p>
                  <p className="text-xs text-muted">{h.user?.name ?? "System"} · {fmtDateTime(h.createdAt)}</p>
                </li>
              )) : <li className="text-[13px] text-muted">No activity recorded.</li>}
              <li className="text-xs text-muted">Sent: {fmtDateTime(q.sentAt)} · Accepted: {fmtDateTime(q.acceptedAt)} · Rejected: {fmtDateTime(q.rejectedAt)}</li>
            </ul>
          </Card>
          {q.notes ? (
            <Card>
              <CardHeader title="Internal notes" />
              <CardBody className="whitespace-pre-wrap text-[13px]">{q.notes}</CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
