import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, isoDate, todayIST } from "@/lib/dates";
import { PageHeader } from "@/components/ui/primitives";
import { DocumentEditor } from "@/components/billing/document-editor";
import { blankItem } from "@/components/billing/editor-utils";
import { loadEditorData, toEditorItems } from "@/server/services/editor-data";
import { saveInvoice } from "@/server/actions/billing";

export const metadata = { title: "New invoice" };

const TYPES = ["TAX_INVOICE", "NON_GST", "PROFORMA", "ADVANCE", "CREDIT_NOTE", "DEBIT_NOTE"];

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ type?: string; clientId?: string; relatedInvoiceId?: string; projectId?: string }> }) {
  await requirePageAccess("billing", "EDIT");
  const sp = await searchParams;
  const data = await loadEditorData();
  const defaultType = data.company.gstRegistered && data.company.hasGstin ? "TAX_INVOICE" : "NON_GST";
  const type = TYPES.includes(sp.type ?? "") ? sp.type! : defaultType;
  const today = todayIST();
  const related = sp.relatedInvoiceId ? await db.invoice.findUnique({ where: { id: sp.relatedInvoiceId }, include: { items: { orderBy: { sortOrder: "asc" } } } }) : null;
  const project = sp.projectId ? await db.project.findUnique({ where: { id: sp.projectId } }) : null;
  const clientId = related?.clientId ?? project?.clientId ?? (data.clients.some((c) => c.id === sp.clientId) ? sp.clientId! : "");
  return (
    <>
      <PageHeader breadcrumb={<Link href="/billing/invoices" className="hover:text-fg">Invoices & Notes</Link>} title={type === "CREDIT_NOTE" ? "New credit note" : type === "DEBIT_NOTE" ? "New debit note" : "New invoice"} />
      <DocumentEditor
        mode="invoice"
        initial={{
          type,
          clientId,
          projectId: related?.projectId ?? project?.id ?? "",
          relatedInvoiceId: related?.id ?? "",
          issueDate: isoDate(today),
          dueDate: type === "CREDIT_NOTE" ? "" : isoDate(addDays(today, data.settings.defaultDueDays)),
          placeOfSupply: related?.placeOfSupply ?? "",
          periodLabel: "",
          reverseCharge: false,
          paymentTerms: type === "CREDIT_NOTE" ? "" : `Payable within ${data.settings.defaultDueDays} days of invoice date.`,
          terms: data.settings.defaultInvoiceTerms ?? "",
          notes: "",
          reason: "",
          items: related ? toEditorItems(related.items) : [blankItem()],
        }}
        {...data}
        save={saveInvoice.bind(null, null)}
        canIssue
      />
    </>
  );
}
