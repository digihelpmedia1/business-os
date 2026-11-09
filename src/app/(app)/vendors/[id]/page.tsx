import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Pencil, Plus } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { D, Decimal, formatMoney, num } from "@/lib/money";
import { fmtDate, fyOf, isoDate, monthsInRange, monthLabel, todayIST, addMonths, startOfMonth } from "@/lib/dates";
import { categoryOptions, projectOptions, vendorOptions } from "@/lib/options";
import { Card, CardBody, CardHeader, DescriptionList, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { StatusBadge } from "@/components/status-badge";
import { SimpleTable } from "@/components/simple-table";
import { RankedBars } from "@/components/charts";
import { archiveVendor, saveBill, saveVendor } from "@/server/actions/vendors";
import { billFields, vendorDefaults, vendorFields } from "../fields";
import { stateName } from "@/lib/gst";
import { INR } from "@/lib/money";

export default async function VendorDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageAccess("vendors");
  const { id } = await params;
  const vendor = await db.vendor.findUnique({
    where: { id },
    include: {
      bills: { where: { deletedAt: null }, orderBy: { billDate: "desc" }, include: { category: true } },
      transactions: { where: { deletedAt: null, type: "EXPENSE" }, orderBy: { date: "desc" }, take: 50, include: { account: true } },
      subscriptions: { where: { deletedAt: null } },
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!vendor) notFound();
  const today = todayIST();
  const fy = fyOf(today);
  const paidFy = vendor.transactions.filter((t) => t.date >= fy.from).reduce((a, t) => a.plus(D(t.amount)), new Decimal(0));
  const paidAll = vendor.transactions.reduce((a, t) => a.plus(D(t.amount)), new Decimal(0));
  const payable = vendor.bills.filter((b) => ["UNPAID", "PARTIALLY_PAID"].includes(b.status)).reduce((a, b) => a.plus(D(b.total).minus(D(b.amountPaid))), new Decimal(0));
  const months = monthsInRange(startOfMonth(addMonths(today, -11)), today);
  const byMonth = months.map((m) => ({ name: monthLabel(m), value: num(vendor.transactions.filter((t) => isoDate(t.date).startsWith(m)).reduce((a, t) => a.plus(D(t.amount)), new Decimal(0))) }));
  const canEdit = can(user.access, "vendors", "EDIT");
  const [vendors, categories, projects] = canEdit ? await Promise.all([vendorOptions(), categoryOptions("EXPENSE"), projectOptions()]) : [[], [], []];
  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/vendors" className="hover:text-fg">Vendors</Link>}
        title={<span className="flex items-center gap-3">{vendor.name} <StatusBadge status={vendor.deletedAt ? "INACTIVE" : vendor.isActive ? "ACTIVE" : "INACTIVE"} /></span>}
        description={vendor.category ?? undefined}
        actions={
          canEdit && !vendor.deletedAt ? (
            <>
              <FormDialog trigger={<><Plus /> Record bill</>} triggerVariant="outline" title="Record purchase bill" fields={billFields({ vendors, categories, projects })} defaults={{ vendorId: vendor.id, billDate: isoDate(today), taxAmount: "0" }} action={saveBill.bind(null, null)} size="lg" />
              <FormDialog trigger={<><Pencil /> Edit</>} triggerVariant="outline" title="Edit vendor" fields={vendorFields} defaults={vendorDefaults(vendor)} action={saveVendor.bind(null, vendor.id)} size="lg" />
              {can(user.access, "vendors", "FULL") ? <ConfirmAction action={archiveVendor.bind(null, vendor.id)} label={<><Archive /> Archive</>} title="Archive vendor?" confirmLabel="Archive" variant="danger-ghost" size="md" /> : null}
            </>
          ) : null
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Paid in ${fy.label}`} value={formatMoney(paidFy)} />
        <StatCard label="Paid (all time)" value={formatMoney(paidAll)} hint="Last 50 payments" />
        <StatCard label="Payable now" value={formatMoney(payable)} tone={payable.gt(0) ? "warning" : "default"} />
        <StatCard label="Bills" value={vendor.bills.length} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList className="sm:grid-cols-1" items={[
              { label: "Contact", value: vendor.contactPerson }, { label: "Email", value: vendor.email }, { label: "Phone", value: vendor.phone },
              { label: "GSTIN", value: vendor.gstin }, { label: "PAN", value: vendor.pan }, { label: "State", value: stateName(vendor.stateCode) },
              { label: "Payment terms", value: vendor.paymentTermsDays ? `${vendor.paymentTermsDays} days` : null }, { label: "Website", value: vendor.website },
              { label: "Address", value: vendor.address }, { label: "Bank / UPI", value: vendor.bankDetails ? <span className="whitespace-pre-wrap">{vendor.bankDetails}</span> : null },
              { label: "Notes", value: vendor.notes ? <span className="whitespace-pre-wrap">{vendor.notes}</span> : null },
            ]} />
          </CardBody>
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Monthly spend (last 12 months)" />
            <CardBody><RankedBars data={byMonth.filter((b) => b.value > 0)} currency={INR} colorIndex={1} emptyMessage="No payments in the last 12 months." /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Bills" action={<Link href={`/vendors/bills?vendorId=${vendor.id}`} className="text-[13px] text-brand">Manage</Link>} />
            {vendor.bills.length ? (
              <SimpleTable head={["Bill", "Date", "Due", "Category", "Status", "Total"]} rows={vendor.bills.slice(0, 20).map((b) => [b.billNumber, fmtDate(b.billDate), fmtDate(b.dueDate), b.category.name, <StatusBadge key="s" status={b.status} />, formatMoney(b.total)])} />
            ) : <EmptyState title="No bills" className="py-8" />}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Payment history" />
              {vendor.transactions.length ? (
                <SimpleTable head={["Date", "Description", "Amount"]} rows={vendor.transactions.slice(0, 15).map((t) => [fmtDate(t.date), <span key="d" className="text-[13px]">{t.description}<span className="block text-xs text-muted">{t.account.name}</span></span>, formatMoney(t.amount)])} />
              ) : <EmptyState title="No payments" className="py-8" />}
            </Card>
            <Card>
              <CardHeader title="Subscriptions & documents" />
              <ul className="divide-y divide-line text-[13px]">
                {vendor.subscriptions.map((s) => <li key={s.id} className="flex justify-between px-5 py-2.5"><span>{s.name}</span><span className="text-muted">renews {fmtDate(s.renewalDate)}</span></li>)}
                {vendor.documents.map((d) => <li key={d.id} className="px-5 py-2.5"><a href={`/api/files/${d.fileId}`} target="_blank" className="text-brand">{d.title}</a></li>)}
                {!vendor.subscriptions.length && !vendor.documents.length ? <li className="px-5 py-8 text-center text-muted">Nothing linked.</li> : null}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
