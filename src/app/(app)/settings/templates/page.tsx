import { Pencil, Plus, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { serviceOptions } from "@/lib/options";
import { formatMoney } from "@/lib/money";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";
import { deleteTemplate, saveTemplate } from "@/server/actions/settings";

export const metadata = { title: "Document Templates" };

export default async function TemplatesPage() {
  const user = await requirePageAccess("settings");
  const [templates, services] = await Promise.all([db.documentTemplate.findMany({ include: { service: true }, orderBy: { name: "asc" } }), serviceOptions()]);
  const fields: FieldDef[] = [
    { name: "name", label: "Template name", required: true },
    { name: "kind", label: "Document type", type: "select", emptyOption: false, options: [{ value: "PROPOSAL", label: "Proposal" }, { value: "QUOTATION", label: "Quotation" }, { value: "ESTIMATE", label: "Estimate" }] },
    { name: "serviceId", label: "Service", type: "select", options: services },
    { name: "title", label: "Default document title" },
    { name: "itemDescription", label: "Line item description", hint: "First line item added by the template" },
    { name: "itemPrice", label: "Line item price (₹)", type: "money", hint: "0 = use the service's default price" },
    { name: "itemUnit", label: "Unit" },
    { name: "isActive", label: "Active", type: "checkbox" },
    { name: "introduction", label: "Introduction", type: "textarea", rows: 3 },
    { name: "scopeOfWork", label: "Scope of work", type: "textarea", rows: 5 },
    { name: "deliverables", label: "Deliverables", type: "textarea", rows: 4 },
    { name: "timeline", label: "Timeline", type: "textarea", rows: 3 },
    { name: "paymentTerms", label: "Payment terms", type: "textarea", rows: 2 },
    { name: "terms", label: "Terms & conditions", type: "textarea", rows: 6 },
  ];
  const canEdit = can(user.access, "settings", "EDIT");
  return (
    <>
      <PageHeader title="Document Templates" description="Reusable starting points for proposals and quotations. Pick one in the editor to fill in scope, deliverables, terms and pricing." actions={canEdit ? <FormDialog trigger={<><Plus /> New template</>} title="New template" fields={fields} defaults={{ kind: "PROPOSAL", isActive: true, itemPrice: "0" }} action={saveTemplate.bind(null, null)} size="xl" /> : null} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => {
          const items = (t.items as { description?: string; unitPrice?: string; unit?: string }[]) ?? [];
          return (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-xs text-muted">{t.kind.toLowerCase()} · {t.service?.name ?? "Any service"}</p>
                </div>
                {!t.isActive ? <Badge>Inactive</Badge> : null}
              </div>
              <p className="mt-3 line-clamp-3 text-[13px] text-muted">{t.introduction ?? t.scopeOfWork ?? "No content yet."}</p>
              {items[0] ? <p className="mt-2 text-xs text-muted">Line: {items[0].description} · {Number(items[0].unitPrice) ? formatMoney(items[0].unitPrice!) : "service price"}</p> : null}
              <div className="mt-auto flex items-center gap-1 pt-4">
                <LinkButton href={`/billing/quotes/new?kind=${t.kind}`} variant="link" size="sm">Use</LinkButton>
                <span className="flex-1" />
                {canEdit ? (
                  <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit template" fields={fields} size="xl" action={saveTemplate.bind(null, t.id)}
                    defaults={{ name: t.name, kind: t.kind, serviceId: t.serviceId, title: t.title, itemDescription: items[0]?.description, itemPrice: items[0]?.unitPrice ?? "0", itemUnit: items[0]?.unit, isActive: t.isActive, introduction: t.introduction, scopeOfWork: t.scopeOfWork, deliverables: t.deliverables, timeline: t.timeline, paymentTerms: t.paymentTerms, terms: t.terms }} />
                ) : null}
                {can(user.access, "settings", "FULL") ? <ConfirmAction action={deleteTemplate.bind(null, t.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title={`Delete “${t.name}”?`} message="Documents already created from it are not affected." confirmLabel="Delete" /> : null}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
