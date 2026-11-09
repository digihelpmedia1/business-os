import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { addDays, isoDate, todayIST } from "@/lib/dates";
import { PageHeader } from "@/components/ui/primitives";
import { DocumentEditor } from "@/components/billing/document-editor";
import { blankItem } from "@/components/billing/editor-utils";
import { loadEditorData } from "@/server/services/editor-data";
import { saveQuote } from "@/server/actions/billing";

export const metadata = { title: "New document" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ kind?: string; clientId?: string }> }) {
  await requirePageAccess("billing", "EDIT");
  const sp = await searchParams;
  const data = await loadEditorData();
  const kind = ["PROPOSAL", "QUOTATION", "ESTIMATE"].includes(sp.kind ?? "") ? sp.kind! : "PROPOSAL";
  const today = todayIST();
  return (
    <>
      <PageHeader breadcrumb={<Link href="/billing/quotes" className="hover:text-fg">Proposals & Quotations</Link>} title={`New ${kind.toLowerCase()}`} />
      <DocumentEditor
        mode="quote"
        initial={{
          kind,
          title: "",
          clientId: data.clients.some((c) => c.id === sp.clientId) ? sp.clientId! : "",
          projectId: "",
          templateId: "",
          issueDate: isoDate(today),
          expiryDate: isoDate(addDays(today, data.settings.quoteValidityDays)),
          placeOfSupply: "",
          gstApplicable: data.settings.gstRegistered,
          terms: data.settings.defaultQuoteTerms ?? "",
          items: [blankItem()],
        }}
        {...data}
        save={saveQuote.bind(null, null)}
      />
    </>
  );
}
