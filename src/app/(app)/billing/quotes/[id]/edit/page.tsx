import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { isoDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui/primitives";
import { DocumentEditor } from "@/components/billing/document-editor";
import { loadEditorData, toEditorItems } from "@/server/services/editor-data";
import { saveQuote } from "@/server/actions/billing";

export const metadata = { title: "Edit document" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAccess("billing", "EDIT");
  const { id } = await params;
  const q = await db.quote.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!q || q.deletedAt) notFound();
  if (q.status !== "DRAFT") redirect(`/billing/quotes/${id}`);
  const data = await loadEditorData();
  return (
    <>
      <PageHeader breadcrumb={<Link href={`/billing/quotes/${id}`} className="hover:text-fg">{q.number}</Link>} title={`Edit ${q.kind.toLowerCase()}`} />
      <DocumentEditor
        mode="quote"
        initial={{
          kind: q.kind,
          locked: true,
          title: q.title,
          clientId: q.clientId,
          projectId: q.projectId ?? "",
          templateId: q.templateId ?? "",
          issueDate: isoDate(q.issueDate),
          expiryDate: isoDate(q.expiryDate),
          placeOfSupply: q.placeOfSupply ?? "",
          gstApplicable: q.gstApplicable,
          introduction: q.introduction ?? "",
          scopeOfWork: q.scopeOfWork ?? "",
          deliverables: q.deliverables ?? "",
          timeline: q.timeline ?? "",
          paymentTerms: q.paymentTerms ?? "",
          terms: q.terms ?? "",
          notes: q.notes ?? "",
          items: toEditorItems(q.items),
        }}
        {...data}
        save={saveQuote.bind(null, id)}
      />
    </>
  );
}
