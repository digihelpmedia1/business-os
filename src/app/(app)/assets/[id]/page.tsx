import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Trash2, Wrench } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { D, Decimal, formatMoney } from "@/lib/money";
import { fmtDate, isoDate, todayIST } from "@/lib/dates";
import { employeeOptions, vendorOptions } from "@/lib/options";
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusBadge } from "@/components/status-badge";
import { addMaintenance, archiveAsset, deleteMaintenance, saveAsset } from "@/server/actions/assets";
import { ASSET_CATEGORIES, assetDefaults, assetFields } from "../fields";

export default async function AssetDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess("assets");
  const { id } = await params;
  const a = await db.asset.findUnique({ where: { id }, include: { vendor: true, assignedEmployee: true, maintenance: { include: { vendor: true }, orderBy: { date: "desc" } } } });
  if (!a || a.deletedAt) notFound();
  const [vendors, employees] = await Promise.all([vendorOptions(), employeeOptions()]);
  const canEdit = can(user.access, "assets", "EDIT");
  const maintCost = a.maintenance.reduce((s, m) => s.plus(D(m.cost)), new Decimal(0));
  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/assets" className="hover:text-fg">Company Assets</Link>}
        title={<span className="flex items-center gap-3">{a.name} <StatusBadge status={a.status} /></span>}
        description={ASSET_CATEGORIES.find((c) => c.value === a.category)?.label}
        actions={canEdit ? (
          <>
            <FormDialog trigger={<><Wrench /> Log maintenance</>} triggerVariant="outline" title="Log maintenance" fields={[
              { name: "date", label: "Date", type: "date", required: true }, { name: "cost", label: "Cost (₹)", type: "money" },
              { name: "description", label: "What was done", required: true, span: 2 }, { name: "vendorId", label: "Service provider", type: "select", options: vendors },
              { name: "nextDueDate", label: "Next service due", type: "date" },
            ]} defaults={{ date: isoDate(todayIST()), cost: "0" }} action={addMaintenance.bind(null, a.id)} />
            <FormDialog trigger={<><Pencil /> Edit</>} triggerVariant="outline" title="Edit asset" fields={assetFields({ vendors, employees })} defaults={assetDefaults(a)} action={saveAsset.bind(null, a.id)} size="lg" />
            {can(user.access, "assets", "FULL") ? <ConfirmAction action={archiveAsset.bind(null, a.id)} label={<Trash2 />} title="Remove this asset?" message="Use status Sold / Retired to keep history; removing hides it everywhere." confirmLabel="Remove" variant="danger-ghost" size="md" /> : null}
          </>
        ) : null}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList className="sm:grid-cols-1" items={[
              { label: "Brand / model", value: [a.brand, a.model].filter(Boolean).join(" ") || null }, { label: "Serial number", value: a.serialNumber },
              { label: "Assigned to", value: a.assignedEmployee ? <Link href={`/team/${a.assignedEmployee.id}`} className="text-brand">{a.assignedEmployee.name}</Link> : null },
              { label: "Location", value: a.location }, { label: "Purchase date", value: fmtDate(a.purchaseDate) }, { label: "Purchase value", value: formatMoney(a.purchaseValue) },
              { label: "Purchased from", value: a.vendor?.name }, { label: "Warranty until", value: fmtDate(a.warrantyUntil) }, { label: "Maintenance spend", value: formatMoney(maintCost) },
              { label: "Notes", value: a.notes },
            ]} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Maintenance history" />
          {a.maintenance.length ? (
            <ul className="divide-y divide-line">
              {a.maintenance.map((m) => (
                <li key={m.id} className="flex items-start gap-3 px-5 py-3 text-[13px]">
                  <div className="flex-1">
                    <p className="font-medium">{m.description}</p>
                    <p className="text-xs text-muted">{fmtDate(m.date)}{m.vendor ? ` · ${m.vendor.name}` : ""}{m.nextDueDate ? ` · next due ${fmtDate(m.nextDueDate)}` : ""}</p>
                  </div>
                  <span className="tabular">{formatMoney(m.cost)}</span>
                  {can(user.access, "assets", "FULL") ? <ConfirmAction action={deleteMaintenance.bind(null, m.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete entry?" confirmLabel="Delete" /> : null}
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Wrench />} title="No maintenance logged" />}
        </Card>
      </div>
    </>
  );
}
