import { Pencil, Plus, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { Badge, Card, Notice, PageHeader } from "@/components/ui/primitives";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteTaxRate, saveTaxRate } from "@/server/actions/settings";

export const metadata = { title: "Tax Rates" };

const fields: FieldDef[] = [
  { name: "name", label: "Name", required: true, placeholder: "GST 18%" },
  { name: "rate", label: "Rate (%)", type: "number", step: "0.01", required: true },
  { name: "isDefault", label: "Default for new services", type: "checkbox" },
  { name: "isActive", label: "Active (selectable)", type: "checkbox" },
];

export default async function TaxesPage() {
  const user = await requirePageAccess("settings");
  const rates = await db.taxRate.findMany({ orderBy: { rate: "asc" } });
  const canEdit = can(user.access, "settings", "FULL");
  return (
    <>
      <PageHeader title="Tax Rates" description="GST rates available on proposals and invoices. Set the applicable rate per service — the system does not assume one." actions={canEdit ? <FormDialog trigger={<><Plus /> Add rate</>} title="Add tax rate" fields={fields} defaults={{ isActive: true }} action={saveTaxRate.bind(null, null)} /> : null} />
      <Notice className="mb-4">Confirm the correct GST rate and SAC code for each service with your CA. Rates are applied per line item; inter-state supplies use IGST, intra-state use CGST + SGST (half each).</Notice>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          {rates.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-3">
              <span className="flex-1 text-sm font-medium">{r.name}</span>
              <span className="tabular w-20 text-right text-sm">{Number(r.rate)}%</span>
              {r.isDefault ? <Badge tone="brand">Default</Badge> : null}
              {!r.isActive ? <Badge>Inactive</Badge> : null}
              {canEdit ? (
                <>
                  <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit tax rate" fields={fields} defaults={{ name: r.name, rate: r.rate.toString(), isDefault: r.isDefault, isActive: r.isActive }} action={saveTaxRate.bind(null, r.id)} />
                  <ConfirmAction action={deleteTaxRate.bind(null, r.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title={`Delete ${r.name}?`} message="Existing documents keep their rates." confirmLabel="Delete" />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
