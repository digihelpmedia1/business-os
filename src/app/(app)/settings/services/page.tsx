import { Pencil, Plus } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { saveService } from "@/server/actions/settings";

export const metadata = { title: "Services Catalog" };

export default async function ServicesPage() {
  const user = await requirePageAccess("settings");
  const [services, rates] = await Promise.all([
    db.service.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { invoiceItems: true, projects: true } } } }),
    db.taxRate.findMany({ where: { isActive: true }, orderBy: { rate: "asc" } }),
  ]);
  const fields: FieldDef[] = [
    { name: "name", label: "Service name", required: true },
    { name: "category", label: "Category" },
    { name: "sacCode", label: "SAC code", placeholder: "e.g. 998361", hint: "Confirm with your CA" },
    { name: "unit", label: "Unit", required: true, placeholder: "Month, Video, Project…" },
    { name: "defaultPrice", label: "Default price (₹)", type: "money" },
    { name: "defaultTaxRate", label: "Default GST rate", type: "select", emptyOption: false, options: [{ value: "0", label: "0% / not set" }, ...rates.map((r) => ({ value: String(Number(r.rate)), label: `${r.name}` }))] },
    { name: "description", label: "Description (printed on documents)", type: "textarea" },
    { name: "isActive", label: "Active", type: "checkbox" },
  ];
  const canEdit = can(user.access, "settings", "EDIT");
  return (
    <>
      <PageHeader title="Services Catalog" description="Your service lines. Picking a service on a proposal or invoice fills in its description, SAC code, price and GST rate — and powers service-wise revenue & profitability." actions={canEdit ? <FormDialog trigger={<><Plus /> Add service</>} title="Add service" fields={fields} defaults={{ unit: "Month", defaultPrice: "0", defaultTaxRate: "0", isActive: true }} action={saveService.bind(null, null)} size="lg" /> : null} />
      <Card className="overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted"><th className="px-4 py-2.5">Service</th><th className="px-4 py-2.5">SAC</th><th className="px-4 py-2.5">Unit</th><th className="px-4 py-2.5 text-right">Default price</th><th className="px-4 py-2.5 text-right">GST</th><th className="px-4 py-2.5">Usage</th><th className="px-4 py-2.5" /></tr></thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3"><span className="font-medium">{s.name}</span>{!s.isActive ? <Badge className="ml-2">Inactive</Badge> : null}<span className="block text-xs text-muted">{s.category}</span></td>
                  <td className="px-4 py-3 font-mono text-xs">{s.sacCode ?? <span className="text-warning">Not set</span>}</td>
                  <td className="px-4 py-3">{s.unit}</td>
                  <td className="tabular px-4 py-3 text-right">{s.defaultPrice.gt(0) ? formatMoney(s.defaultPrice) : <span className="text-muted">—</span>}</td>
                  <td className="tabular px-4 py-3 text-right">{Number(s.defaultTaxRate) ? `${Number(s.defaultTaxRate)}%` : <span className="text-warning">Not set</span>}</td>
                  <td className="px-4 py-3 text-xs text-muted">{s._count.invoiceItems} invoice line(s) · {s._count.projects} project(s)</td>
                  <td className="px-4 py-3 text-right">{canEdit ? <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit service" fields={fields} defaults={{ name: s.name, category: s.category, sacCode: s.sacCode, unit: s.unit, defaultPrice: s.defaultPrice.toFixed(2), defaultTaxRate: String(Number(s.defaultTaxRate)), description: s.description, isActive: s.isActive }} action={saveService.bind(null, s.id)} size="lg" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
