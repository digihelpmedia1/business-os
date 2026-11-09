import { Pencil, Plus, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { CATEGORY_KIND_LABELS } from "@/lib/finance/constants";
import { Badge, Card, CardHeader, PageHeader, Notice } from "@/components/ui/primitives";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteCategory, saveCategory } from "@/server/actions/finance";

export const metadata = { title: "Categories" };

const fields: FieldDef[] = [
  { name: "name", label: "Name", required: true },
  { name: "type", label: "Type", type: "select", emptyOption: false, options: [{ value: "EXPENSE", label: "Expense" }, { value: "INCOME", label: "Income" }] },
  { name: "kind", label: "Treatment in statements", type: "select", emptyOption: false, span: 2, options: Object.entries(CATEGORY_KIND_LABELS).map(([value, v]) => ({ value, label: `${v.label} — ${v.help}` })) },
  { name: "isAcquisition", label: "Counts as client-acquisition spend (CAC)", type: "checkbox", span: 2 },
  { name: "isActive", label: "Active", type: "checkbox" },
  { name: "description", label: "Description", type: "textarea" },
];

export default async function CategoriesPage() {
  const user = await requirePageAccess("finance");
  const cats = await db.category.findMany({ orderBy: [{ type: "asc" }, { kind: "asc" }, { name: "asc" }], include: { _count: { select: { transactions: true, vendorBills: true } } } });
  const canEdit = can(user.access, "finance", "EDIT");
  const group = (type: "INCOME" | "EXPENSE") => cats.filter((c) => c.type === type);
  return (
    <>
      <PageHeader
        title="Categories"
        description="How each category is treated decides where it lands in the P&L, cash flow and balance sheet."
        actions={canEdit ? <FormDialog trigger={<><Plus /> New category</>} title="New category" fields={fields} defaults={{ type: "EXPENSE", kind: "OPERATING_EXPENSE", isActive: true }} action={saveCategory.bind(null, null)} /> : null}
      />
      <Notice className="mb-5">Income from invoices is recorded automatically under <b>Client Payments</b> when you record a payment — this prevents revenue from being counted twice.</Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        {(["EXPENSE", "INCOME"] as const).map((type) => (
          <Card key={type}>
            <CardHeader title={type === "EXPENSE" ? "Expense categories" : "Income categories"} />
            <ul className="divide-y divide-line">
              {group(type).map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${c.isActive ? "" : "text-muted line-through"}`}>{c.name}</p>
                    <p className="text-xs text-muted">{CATEGORY_KIND_LABELS[c.kind].label} · {c._count.transactions + c._count.vendorBills} record(s)</p>
                  </div>
                  {c.isAcquisition ? <Badge tone="accent">CAC</Badge> : null}
                  {c.isSystem ? <Badge>System</Badge> : null}
                  {canEdit ? (
                    <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit category" fields={fields} action={saveCategory.bind(null, c.id)}
                      defaults={{ name: c.name, type: c.type, kind: c.kind, isAcquisition: c.isAcquisition, isActive: c.isActive, description: c.description }} />
                  ) : null}
                  {can(user.access, "finance", "FULL") && !c.isSystem ? <ConfirmAction action={deleteCategory.bind(null, c.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title={`Delete “${c.name}”?`} message="Categories in use are deactivated instead." confirmLabel="Delete" /> : null}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
