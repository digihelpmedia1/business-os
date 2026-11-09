import Link from "next/link";
import { Download, FileSpreadsheet } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can, type ModuleKey } from "@/lib/permissions";
import { withParams, type SearchParams } from "@/lib/list";
import { pageRange } from "@/lib/page-range";
import { D, Decimal, formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { Card, CardBody, CardHeader, PageHeader, Notice } from "@/components/ui/primitives";
import { RangeFilter } from "@/components/range-filter";

export const metadata = { title: "Reports & Analytics" };

const GROUPS: { title: string; module: ModuleKey; reports: { key: string; label: string; desc: string; view?: string; ranged?: boolean }[] }[] = [
  { title: "Financial statements", module: "finance", reports: [
    { key: "pnl", label: "Profit & Loss", desc: "Revenue, costs and profit (accrual)", view: "/finance/statements", ranged: true },
    { key: "cashflow", label: "Cash Flow", desc: "Operating, investing, financing", view: "/finance/statements?tab=cashflow", ranged: true },
    { key: "balance", label: "Balance Sheet", desc: "Management balance sheet as of today", view: "/finance/statements?tab=balance" },
    { key: "monthly", label: "Monthly Summary", desc: "Revenue, expenses, cash by month", view: "/finance/statements?tab=monthly", ranged: true },
    { key: "receivables", label: "Accounts Receivable", desc: "Unpaid invoices with ageing", view: "/finance/statements?tab=receivables" },
    { key: "payables", label: "Accounts Payable", desc: "Unpaid vendor bills with ageing", view: "/finance/statements?tab=payables" },
    { key: "transactions", label: "Transactions Ledger", desc: "Every income, expense and transfer", view: "/finance/transactions" },
  ] },
  { title: "Billing", module: "billing", reports: [
    { key: "invoices", label: "Invoice Register", desc: "All invoices & notes with GST split", view: "/billing/invoices" },
    { key: "payments", label: "Receipts Register", desc: "Payments received incl. TDS", view: "/billing/payments" },
    { key: "quotes", label: "Proposals & Quotations", desc: "Pipeline of documents and status", view: "/billing/quotes" },
    { key: "clients", label: "Client List", desc: "Clients with GSTIN and CRM IDs", view: "/billing/clients" },
  ] },
  { title: "Business intelligence", module: "intelligence", reports: [
    { key: "metrics", label: "Key Metrics", desc: "All BI metrics with formulas", view: "/intelligence", ranged: true },
    { key: "client-profitability", label: "Client Profitability", desc: "Revenue vs attributed cost per client", view: "/intelligence?tab=profitability", ranged: true },
    { key: "service-profitability", label: "Service Profitability", desc: "Revenue vs cost per service", view: "/intelligence?tab=profitability", ranged: true },
    { key: "project-profitability", label: "Project Profitability", desc: "Revenue, expenses, time cost per project", view: "/intelligence?tab=projects", ranged: true },
  ] },
  { title: "Operations", module: "projects", reports: [
    { key: "projects", label: "Projects (all time)", desc: "Status, budget and profitability", view: "/projects" },
    { key: "time", label: "Timesheet", desc: "Hours and cost by person & project", view: "/projects/time", ranged: true },
  ] },
  { title: "Vendors & expenses", module: "vendors", reports: [
    { key: "vendors", label: "Vendor List", desc: "Vendors with GSTIN and terms", view: "/vendors" },
    { key: "bills", label: "Purchase Bills", desc: "Bills, input GST and payment status", view: "/vendors/bills" },
  ] },
  { title: "People & assets", module: "team", reports: [
    { key: "employees", label: "Team List", desc: "Employees, freelancers, compensation", view: "/team" },
  ] },
  { title: "Subscriptions & assets", module: "assets", reports: [
    { key: "subscriptions", label: "Subscriptions", desc: "Costs and renewal dates", view: "/subscriptions" },
    { key: "assets", label: "Asset Register", desc: "Equipment, value, warranty, assignee", view: "/assets" },
  ] },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("reports");
  const sp = await searchParams;
  const range = await pageRange(sp, "last_month");
  const rangeParams = { range: range.preset, from: range.preset === "custom" ? range.fromIso : null, to: range.preset === "custom" ? range.toIso : null };
  const showGst = can(user.access, "finance") || can(user.access, "billing");
  let gst: { rate: string; taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }[] = [];
  let inputGst = new Decimal(0);
  if (showGst) {
    const items = await db.invoiceItem.findMany({
      where: { invoice: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] }, type: { in: ["TAX_INVOICE", "DEBIT_NOTE", "CREDIT_NOTE"] }, issueDate: { gte: range.from, lte: range.to } } },
      select: { taxRate: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true, invoice: { select: { type: true } } },
    });
    const map = new Map<string, { rate: string; taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }>();
    for (const it of items) {
      const sign = it.invoice.type === "CREDIT_NOTE" ? -1 : 1;
      const k = Number(it.taxRate).toString();
      const row = map.get(k) ?? { rate: k, taxable: new Decimal(0), cgst: new Decimal(0), sgst: new Decimal(0), igst: new Decimal(0) };
      row.taxable = row.taxable.plus(D(it.taxableAmount).times(sign));
      row.cgst = row.cgst.plus(D(it.cgstAmount).times(sign));
      row.sgst = row.sgst.plus(D(it.sgstAmount).times(sign));
      row.igst = row.igst.plus(D(it.igstAmount).times(sign));
      map.set(k, row);
    }
    gst = [...map.values()].sort((a, b) => Number(a.rate) - Number(b.rate));
    const [t, b] = await Promise.all([
      db.transaction.aggregate({ where: { deletedAt: null, type: "EXPENSE", vendorBillId: null, date: { gte: range.from, lte: range.to } }, _sum: { taxAmount: true } }),
      db.vendorBill.aggregate({ where: { deletedAt: null, status: { not: "CANCELLED" }, billDate: { gte: range.from, lte: range.to } }, _sum: { taxAmount: true } }),
    ]);
    inputGst = D(t._sum.taxAmount).plus(D(b._sum.taxAmount));
  }
  const outputTotal = gst.reduce((a, r) => a.plus(r.cgst).plus(r.sgst).plus(r.igst), new Decimal(0));
  const groups = GROUPS.filter((g) => can(user.access, g.module) || (g.module === "intelligence" && can(user.access, "reports")));
  return (
    <>
      <PageHeader
        title="Reports & Analytics"
        description="Export any report as CSV (opens in Excel / Google Sheets). Date-ranged reports use the period selected here."
        actions={<RangeFilter preset={range.preset} from={range.fromIso} to={range.toIso} />}
      />
      {showGst ? (
        <Card className="mb-6">
          <CardHeader title="GST summary" description={`${range.label} (${fmtDate(range.from)} – ${fmtDate(range.to)}) · issued GST invoices, debit & credit notes`} />
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-xs text-muted"><th className="px-4 py-2 text-left">GST rate</th><th className="px-4 py-2 text-right">Taxable value</th><th className="px-4 py-2 text-right">CGST</th><th className="px-4 py-2 text-right">SGST</th><th className="px-4 py-2 text-right">IGST</th></tr></thead>
              <tbody>
                {gst.length ? gst.map((r) => (
                  <tr key={r.rate} className="border-b border-line">
                    <td className="px-4 py-2.5">{r.rate}%</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatMoney(r.taxable)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatMoney(r.cgst)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatMoney(r.sgst)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatMoney(r.igst)}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No GST invoices in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          <CardBody className="grid gap-3 border-t border-line text-sm sm:grid-cols-3">
            <div><p className="text-xs text-muted">Output GST</p><p className="tabular font-semibold">{formatMoney(outputTotal)}</p></div>
            <div><p className="text-xs text-muted">Input GST recorded (claimable)</p><p className="tabular font-semibold">{formatMoney(inputGst)}</p></div>
            <div><p className="text-xs text-muted">Indicative net payable</p><p className="tabular font-semibold">{formatMoney(outputTotal.minus(inputGst))}</p></div>
          </CardBody>
          <Notice className="m-4 mt-0">Indicative only — reconcile input credit with GSTR-2B and file returns with your CA. Export the Invoice Register for GSTR-1 preparation.</Notice>
        </Card>
      ) : null}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="mb-3 text-sm font-semibold text-muted">{g.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {g.reports.map((r) => (
                <Card key={r.key} className="flex flex-col p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><FileSpreadsheet className="h-4 w-4" /></span>
                    <div>
                      <p className="text-sm font-semibold">{r.label}</p>
                      <p className="text-xs text-muted">{r.desc}{r.ranged ? ` · ${range.label}` : ""}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-3 text-[13px]">
                    <a href={withParams(`/api/export/${r.key}`, {}, r.ranged ? rangeParams : {})} className="inline-flex items-center gap-1 font-medium text-brand hover:underline"><Download className="h-3.5 w-3.5" /> CSV</a>
                    {r.view ? <Link href={r.view} className="text-muted hover:text-fg">Open</Link> : null}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
