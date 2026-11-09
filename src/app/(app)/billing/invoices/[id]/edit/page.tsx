import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui/primitives";
import { DocumentEditor } from "@/components/billing/document-editor";
import { loadEditorData, toEditorItems } from "@/server/services/editor-data";
import { saveInvoice } from "@/server/actions/billing";

export const metadata = { title: "Edit draft invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess("billing", "EDIT");
  const { id } = await params;
  const inv = await db.invoice.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!inv || inv.deletedAt) notFound();
  if (inv.status !== "DRAFT") redirect(`/billing/invoices/${id}`);
  const data = await loadEditorData();
  return (
    <>
      <PageHeader breadcrumb={<Link href={`/billing/invoices/${id}`} className="hover:text-fg">Draft invoice</Link>} title="Edit draft" />
      <DocumentEditor
        mode="invoice"
        initial={{
          type: inv.type,
          clientId: inv.clientId,
          projectId: inv.projectId ?? "",
          relatedInvoiceId: inv.relatedInvoiceId ?? "",
          issueDate: isoDate(inv.issueDate),
          dueDate: isoDate(inv.dueDate),
          placeOfSupply: inv.placeOfSupply ?? "",
          periodLabel: inv.periodLabel ?? "",
          reverseCharge: inv.reverseCharge,
          paymentTerms: inv.paymentTerms ?? "",
          terms: inv.terms ?? "",
          notes: inv.notes ?? "",
          reason: inv.reason ?? "",
          items: toEditorItems(inv.items),
        }}
        {...data}
        save={saveInvoice.bind(null, id)}
        canIssue
      />
    </>
  );
}
