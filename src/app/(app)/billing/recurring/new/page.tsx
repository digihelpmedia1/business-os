import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { addMonths, isoDate, startOfMonth, todayIST } from "@/lib/dates";
import { clientOptions } from "@/lib/options";
import { PageHeader } from "@/components/ui/primitives";
import { RecurringForm } from "@/components/billing/recurring-form";
import { blankRecurringItem } from "@/components/billing/editor-utils";
import { loadEditorData } from "@/server/services/editor-data";
import { saveRecurring } from "@/server/actions/billing";

export const metadata = { title: "New recurring invoice" };

export default async function NewRecurring() {
  await requirePageAccess("billing", "EDIT");
  const [data, clients] = await Promise.all([loadEditorData(), clientOptions()]);
  return (
    <>
      <PageHeader breadcrumb={<Link href="/billing/recurring" className="hover:text-fg">Recurring Invoices</Link>} title="New recurring invoice" />
      <RecurringForm
        initial={{
          name: "", clientId: "", projectId: "", invoiceType: data.company.gstRegistered && data.company.hasGstin ? "TAX_INVOICE" : "NON_GST", frequency: "MONTHLY",
          startDate: isoDate(addMonths(startOfMonth(todayIST()), 1)), endDate: "", dueInDays: String(data.settings.defaultDueDays), autoIssue: false, isActive: true, notes: "",
          items: [blankRecurringItem()],
        }}
        clients={clients}
        projects={data.projects}
        services={data.services}
        taxRates={data.taxRates}
        gstRegistered={data.company.gstRegistered}
        save={saveRecurring.bind(null, null)}
      />
    </>
  );
}
