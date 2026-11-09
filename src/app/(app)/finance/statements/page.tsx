import Link from "next/link";
import { Download } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { param, withParams, type SearchParams } from "@/lib/list";
import { pageRange } from "@/lib/page-range";
import { getDisplayCurrency } from "@/lib/settings";
import { formatMoney, num, type Decimal } from "@/lib/money";
import { fmtDate, todayIST, toDateOnly } from "@/lib/dates";
import { getBalanceSheet, getCashFlow, getMonthlySeries, getPayables, getPnl, getReceivables } from "@/lib/finance/reports";
import { Card, CardBody, CardHeader, Notice, PageHeader } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/data-table";
import { RangeFilter } from "@/components/range-filter";
import { GroupedBars } from "@/components/charts";
import type { Bucket } from "@/lib/finance/engine";

export const metadata = { title: "Financial Statements" };

const TABS = [
  { key: "pnl", label: "Profit & Loss" },
  { key: "cashflow", label: "Cash Flow" },
  { key: "balance", label: "Balance Sheet" },
  { key: "receivables", label: "Accounts Receivable" },
  { key: "payables", label: "Accounts Payable" },
  { key: "monthly", label: "Monthly Summary" },
];

export default async function StatementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageAccess("finance");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === param(sp, "tab")) ? param(sp, "tab")! : "pnl";
  const range = await pageRange(sp, tab === "monthly" ? "this_fy" : "this_month");
  const currency = await getDisplayCurrency();
  const m = (v: Decimal | number) => formatMoney(v, { currency });
  let asOf = todayIST();
  try {
    if (param(sp, "asOf")) asOf = toDateOnly(param(sp, "asOf")!);
  } catch {
    /* default today */
  }

  const header = (
    <PageHeader
      title="Financial Statements"
      description={`Accrual-basis profit, cash-basis cash flow. Figures in ${currency.code}${currency.code !== "INR" ? ` (converted at ₹${currency.rateToInr.toFixed(2)})` : ""}.`}
      actions={
        <>
          {["pnl", "cashflow", "monthly"].includes(tab) ? <RangeFilter preset={range.preset} from={range.fromIso} to={range.toIso} /> : null}
          <LinkButton href={withParams(`/api/export/${tab}`, sp, {})} variant="outline"><Download /> CSV</LinkButton>
        </>
      }
    />
  );
  const tabs = <LinkTabs active={tab} tabs={TABS.map((t) => ({ ...t, href: withParams("/finance/statements", sp, { tab: t.key }) }))} />;

  if (tab === "pnl") {
    const pnl = await getPnl(range);
    const lines = (b: Bucket) => pnl.lines.filter((l) => l.bucket === b);
    return (
      <>
        {header}
        {tabs}
        <Card className="mx-auto max-w-3xl">
          <CardHeader title="Profit & Loss Statement" description={`${range.label} (${fmtDate(range.from)} – ${fmtDate(range.to)}) · accrual basis`} />
          <CardBody className="space-y-1 text-sm">
            <Section title="Revenue" />
            {lines("REVENUE").map((l) => <Row key={l.categoryName} label={l.categoryName} value={m(l.amount)} indent />)}
            <Row label="Net revenue" value={m(pnl.revenue)} bold />
            <Section title="Cost of services" />
            {lines("COS").map((l) => <Row key={l.categoryName} label={l.categoryName} value={m(l.amount)} indent />)}
            <Row label="Gross profit" value={m(pnl.grossProfit)} bold sub={pnl.revenue.gt(0) ? `${((num(pnl.grossProfit) / num(pnl.revenue)) * 100).toFixed(1)}% margin` : undefined} />
            <Section title="Operating expenses" />
            {lines("OPEX").map((l) => <Row key={l.categoryName} label={l.categoryName} value={m(l.amount)} indent />)}
            <Row label="Operating profit" value={m(pnl.operatingProfit)} bold sub={pnl.revenue.gt(0) ? `${((num(pnl.operatingProfit) / num(pnl.revenue)) * 100).toFixed(1)}% margin` : undefined} />
            {lines("OTHER_INCOME").length || lines("NONOP").length ? <Section title="Other income & expenses" /> : null}
            {lines("OTHER_INCOME").map((l) => <Row key={l.categoryName} label={`+ ${l.categoryName}`} value={m(l.amount)} indent />)}
            {lines("NONOP").map((l) => <Row key={l.categoryName} label={`− ${l.categoryName}`} value={m(l.amount)} indent />)}
            <div className={`mt-3 flex justify-between rounded-lg px-3 py-3 text-base font-semibold ${pnl.netProfit.gte(0) ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
              <span>Net {pnl.netProfit.gte(0) ? "profit" : "loss"}</span>
              <span className="tabular">{m(pnl.netProfit)}</span>
            </div>
          </CardBody>
        </Card>
        <Notice className="mx-auto mt-4 max-w-3xl">
          Revenue = taxable value of issued invoices &amp; debit notes − credit notes (GST excluded), plus income recorded without an invoice. Expenses exclude claimable input GST,
          capital purchases, tax payments and owner drawings. Cash actually received in this period: <b>{m(pnl.clientReceipts)}</b>.
        </Notice>
      </>
    );
  }

  if (tab === "cashflow") {
    const cf = await getCashFlow(range);
    const block = (title: string, s: { lines: { label: string; amount: Decimal }[]; total: Decimal }) => (
      <>
        <Section title={title} />
        {s.lines.length ? s.lines.map((l) => <Row key={l.label} label={l.label} value={m(l.amount)} indent />) : <p className="pl-4 text-[13px] text-muted">No activity</p>}
        <Row label={`Net cash from ${title.toLowerCase()}`} value={m(s.total)} bold />
      </>
    );
    return (
      <>
        {header}
        {tabs}
        <Card className="mx-auto max-w-3xl">
          <CardHeader title="Cash Flow Statement" description={`${range.label} · direct method, all bank & cash accounts`} />
          <CardBody className="space-y-1 text-sm">
            <Row label="Opening cash balance" value={m(cf.opening)} bold />
            {cf.openingIntroduced.gt(0) ? <Row label="Opening balances of accounts added in this period" value={m(cf.openingIntroduced)} indent /> : null}
            {block("Operating activities", cf.operating)}
            {block("Investing activities", cf.investing)}
            {block("Financing activities", cf.financing)}
            <Row label="Net change in cash" value={m(cf.netChange)} bold />
            <div className="mt-3 flex justify-between rounded-lg bg-brand-soft px-3 py-3 text-base font-semibold text-brand">
              <span>Closing cash balance</span>
              <span className="tabular">{m(cf.closing)}</span>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  if (tab === "balance") {
    const bs = await getBalanceSheet(asOf);
    return (
      <>
        {header}
        {tabs}
        <form className="mb-4 flex items-center gap-2 text-sm" action="/finance/statements">
          <input type="hidden" name="tab" value="balance" />
          <label className="text-muted" htmlFor="asOf">As of</label>
          <input id="asOf" type="date" name="asOf" defaultValue={asOf.toISOString().slice(0, 10)} className="h-9 rounded-lg border border-line-strong bg-surface px-3" />
          <button className="h-9 rounded-lg border border-line-strong bg-surface px-3 hover:bg-surface-2" type="submit">Update</button>
        </form>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Assets" description={`As of ${fmtDate(asOf)}`} />
            <CardBody className="space-y-1 text-sm">
              {bs.assetLines.map((l) => <Row key={l.label} label={l.label} value={m(l.amount)} />)}
              <Row label="Total assets" value={m(bs.totalAssets)} bold />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Liabilities & equity" description={`As of ${fmtDate(asOf)}`} />
            <CardBody className="space-y-1 text-sm">
              {bs.liabilityLines.map((l) => <Row key={l.label} label={l.label} value={m(l.amount)} />)}
              <Row label="Total liabilities" value={m(bs.totalLiabilities)} bold />
              <Section title="Equity" />
              {bs.equityLines.map((l) => <Row key={l.label} label={l.label} value={m(l.amount)} indent />)}
              <Row label="Total equity" value={m(bs.totalEquity)} bold />
              <Row label="Total liabilities & equity" value={m(bs.totalLiabilities.plus(bs.totalEquity))} bold />
            </CardBody>
          </Card>
        </div>
        <Notice className="mt-4">
          This is a simplified management balance sheet, not a statutory one: fixed assets are shown at cost (no depreciation) and retained earnings is the balancing figure. Have your CA prepare statutory accounts.
        </Notice>
      </>
    );
  }

  if (tab === "receivables" || tab === "payables") {
    const data = tab === "receivables" ? await getReceivables(asOf) : await getPayables(asOf);
    return (
      <>
        {header}
        {tabs}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Card className="p-4"><p className="text-[13px] text-muted">Total outstanding</p><p className="tabular mt-1 text-lg font-semibold">{m(data.total)}</p></Card>
          {data.buckets.map((b) => (
            <Card key={b.bucket} className="p-4"><p className="text-[13px] text-muted">{b.bucket}</p><p className={`tabular mt-1 text-lg font-semibold ${b.bucket !== "Not due" && b.amount.gt(0) ? "text-danger" : ""}`}>{m(b.amount)}</p></Card>
          ))}
        </div>
        <Card className="overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-left text-xs text-muted">
                <th className="px-4 py-2.5">{tab === "receivables" ? "Invoice" : "Bill"}</th><th className="px-4 py-2.5">{tab === "receivables" ? "Client" : "Vendor"}</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Age</th><th className="px-4 py-2.5 text-right">Total</th><th className="px-4 py-2.5 text-right">Outstanding</th>
              </tr></thead>
              <tbody>
                {data.rows.length ? data.rows.map((r) => {
                  const isAr = "client" in r;
                  return (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">{isAr ? <Link className="text-brand" href={`/billing/invoices/${r.id}`}>{(r as { number: string | null }).number}</Link> : (r as { billNumber: string }).billNumber}</td>
                      <td className="px-4 py-2.5">{isAr ? (r as { client: { name: string } }).client.name : (r as { vendor: { name: string } }).vendor.name}</td>
                      <td className="px-4 py-2.5">{fmtDate(isAr ? (r as { issueDate: Date }).issueDate : (r as { billDate: Date }).billDate)}</td>
                      <td className="px-4 py-2.5">{fmtDate(r.dueDate)}</td>
                      <td className={`px-4 py-2.5 ${r.daysOverdue > 0 ? "text-danger" : "text-muted"}`}>{r.bucket}</td>
                      <td className="tabular px-4 py-2.5 text-right">{m(r.total)}</td>
                      <td className="tabular px-4 py-2.5 text-right font-medium">{m(r.outstanding)}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">Nothing outstanding.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  }

  // monthly summary
  const series = await getMonthlySeries(range);
  return (
    <>
      {header}
      {tabs}
      <Card className="mb-4">
        <CardHeader title="Revenue vs expenses" description={range.label} />
        <CardBody><GroupedBars data={series} series={[{ key: "revenue", name: "Revenue" }, { key: "expenses", name: "Expenses" }]} currency={currency} /></CardBody>
      </Card>
      <Card className="overflow-hidden">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line bg-surface-2 text-xs text-muted">
              <th className="px-4 py-2.5 text-left">Month</th><th className="px-4 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5 text-right">Expenses</th><th className="px-4 py-2.5 text-right">Net profit</th><th className="px-4 py-2.5 text-right">Cash in</th><th className="px-4 py-2.5 text-right">Cash out</th><th className="px-4 py-2.5 text-right">Net cash</th>
            </tr></thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.month} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium">{s.label}</td>
                  <td className="tabular px-4 py-2.5 text-right">{m(s.revenue)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{m(s.expenses)}</td>
                  <td className={`tabular px-4 py-2.5 text-right font-medium ${s.profit < 0 ? "text-danger" : ""}`}>{m(s.profit)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{m(s.cashIn)}</td>
                  <td className="tabular px-4 py-2.5 text-right">{m(s.cashOut)}</td>
                  <td className={`tabular px-4 py-2.5 text-right ${s.netCash < 0 ? "text-danger" : ""}`}>{m(s.netCash)}</td>
                </tr>
              ))}
              <tr className="bg-surface-2 font-semibold">
                <td className="px-4 py-2.5">Total</td>
                {(["revenue", "expenses", "profit", "cashIn", "cashOut", "netCash"] as const).map((k) => (
                  <td key={k} className="tabular px-4 py-2.5 text-right">{m(series.reduce((a, s) => a + s[k], 0))}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Section({ title }: { title: string }) {
  return <p className="pt-4 text-xs font-semibold uppercase tracking-wide text-muted first:pt-0">{title}</p>;
}

function Row({ label, value, bold, indent, sub }: { label: string; value: string; bold?: boolean; indent?: boolean; sub?: string }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${bold ? "border-t border-line pt-2 font-semibold" : ""} ${indent ? "pl-4 text-muted" : ""}`}>
      <span>{label}{sub ? <span className="ml-2 text-xs font-normal text-muted">{sub}</span> : null}</span>
      <span className="tabular text-fg">{value}</span>
    </div>
  );
}
