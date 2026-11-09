import { Pencil } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fyOf, todayIST } from "@/lib/dates";
import { DEFAULT_SERIES, formatNumber } from "@/lib/numbering-defaults";
import { getSettings } from "@/lib/settings";
import { Card, Notice, PageHeader } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { saveSeries } from "@/server/actions/settings";

export const metadata = { title: "Document Numbering" };

export default async function NumberingPage() {
  const user = await requirePageAccess("settings");
  const settings = await getSettings();
  const fy = fyOf(todayIST(), settings.fyStartMonth);
  const [series, counters] = await Promise.all([db.documentSeries.findMany(), db.seriesCounter.findMany({ where: { fyLabel: { in: [fy.short, "ALL"] } } })]);
  return (
    <>
      <PageHeader title="Document Numbering" description={`Numbers are assigned when a document is issued and reset every financial year (${fy.label}). Series are gap-free and never reused.`} />
      <Notice className="mb-4">GST rules require invoice numbers to be unique within a financial year and at most 16 characters (letters, digits, “/” and “-”). The format here is PREFIX/FY/NUMBER, e.g. INV/{fy.short}/0001.</Notice>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5">Document</th><th className="px-4 py-2.5">Prefix</th><th className="px-4 py-2.5">Next number</th><th className="px-4 py-2.5">Issued this FY</th><th className="px-4 py-2.5" /></tr></thead>
          <tbody>
            {DEFAULT_SERIES.map((d) => {
              const s = series.find((x) => x.docType === d.docType) ?? { prefix: d.prefix, padding: 4, includeFy: true };
              const used = counters.find((c) => c.docType === d.docType && c.fyLabel === (s.includeFy ? fy.short : "ALL"))?.lastNumber ?? 0;
              return (
                <tr key={d.docType} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{d.label}</td>
                  <td className="px-4 py-3 font-mono">{s.prefix}</td>
                  <td className="px-4 py-3 font-mono">{formatNumber(s.prefix, s.includeFy ? fy.short : null, used + 1, s.padding)}</td>
                  <td className="px-4 py-3">{used}</td>
                  <td className="px-4 py-3 text-right">
                    {can(user.access, "settings", "FULL") ? (
                      <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title={`Numbering — ${d.label}`} description="Changes apply to the next document issued. Existing numbers never change."
                        fields={[{ name: "prefix", label: "Prefix", required: true }, { name: "padding", label: "Digits", type: "number", min: 3, max: 6 }, { name: "includeFy", label: "Include financial year (resets yearly)", type: "checkbox", span: 2 }]}
                        defaults={{ prefix: s.prefix, padding: s.padding, includeFy: s.includeFy }} action={saveSeries.bind(null, d.docType)} />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
