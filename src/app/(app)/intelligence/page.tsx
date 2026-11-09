import Link from "next/link";
import { Download, Info } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { param, withParams, type SearchParams } from "@/lib/list";
import { pageRange } from "@/lib/page-range";
import { getDisplayCurrency } from "@/lib/settings";
import { formatMoney, num, type DisplayCurrency } from "@/lib/money";
import { addMonths, endOfMonth, fyOf, monthLongLabel, quarterOf, startOfMonth, todayIST, addDays } from "@/lib/dates";
import { clientProfitability, computeMetrics, forecast, serviceProfitability, type Metric } from "@/lib/finance/metrics";
import { getPnl, projectProfitability } from "@/lib/finance/reports";
import { Card, CardBody, CardHeader, Notice, PageHeader, Badge } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/data-table";
import { RangeFilter } from "@/components/range-filter";
import { RankedBars, TrendLines } from "@/components/charts";
import { StatusBadge } from "@/components/status-badge";
import { pct } from "@/lib/utils";

export const metadata = { title: "Business Intelligence" };

function fmtMetric(m: Metric, currency: DisplayCurrency, value = m.value) {
  if (value === null || value === undefined) return m.infinite ? "Not burning cash" : "Insufficient Data";
  switch (m.format) {
    case "money": return formatMoney(value, { currency, compact: Math.abs(value) >= 1e5 });
    case "percent": return pct(value);
    case "ratio": return `${value.toFixed(2)} : 1`;
    case "months": return `${value.toFixed(1)} months`;
    default: return value.toLocaleString("en-IN");
  }
}

export default async function IntelligencePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePageAccess("intelligence");
  const sp = await searchParams;
  const tab = ["overview", "profitability", "projects", "comparisons", "forecast"].includes(param(sp, "tab") ?? "") ? param(sp, "tab")! : "overview";
  const range = await pageRange(sp, "last_3_months");
  const currency = await getDisplayCurrency();
  const m = (v: number) => formatMoney(v, { currency });

  const header = (
    <PageHeader
      title="Business Intelligence"
      description={`How healthy is the business? Every number is calculated from your records — with its formula. ${currency.code !== "INR" ? `Shown in ${currency.code}.` : ""}`}
      actions={
        <>
          {["overview", "profitability"].includes(tab) ? <RangeFilter preset={range.preset} from={range.fromIso} to={range.toIso} /> : null}
          <LinkButton href={withParams(`/api/export/${tab === "profitability" ? "client-profitability" : tab === "projects" ? "project-profitability" : "metrics"}`, sp, {})} variant="outline"><Download /> CSV</LinkButton>
        </>
      }
    />
  );
  const tabs = (
    <LinkTabs
      active={tab}
      tabs={[
        { key: "overview", label: "Key metrics", href: withParams("/intelligence", sp, { tab: null }) },
        { key: "profitability", label: "Client & service profitability", href: withParams("/intelligence", sp, { tab: "profitability" }) },
        { key: "projects", label: "Project profitability", href: withParams("/intelligence", sp, { tab: "projects" }) },
        { key: "comparisons", label: "Comparisons", href: withParams("/intelligence", sp, { tab: "comparisons" }) },
        { key: "forecast", label: "Forecast", href: withParams("/intelligence", sp, { tab: "forecast" }) },
      ]}
    />
  );

  if (tab === "overview") {
    const { metrics } = await computeMetrics(range);
    const groups = ["Financial", "Agency"] as const;
    return (
      <>
        {header}
        {tabs}
        <Notice className="mb-5">
          <b>Accrual vs cash:</b> revenue and profit are recognised on invoice date (excl. GST); cash flow and runway use actual bank &amp; cash movements. Comparisons are against the previous period of equal length.
        </Notice>
        {groups.map((g) => (
          <section key={g} className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-muted">{g} metrics · {range.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.filter((x) => x.group === g).map((x) => {
                const change = x.value !== null && x.previous !== null && x.previous !== undefined && x.previous !== 0 && x.format === "money" ? (x.value - x.previous) / Math.abs(x.previous) : null;
                return (
                  <Card key={x.key} className="flex flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-medium text-muted">{x.label}</p>
                      <span title={x.formula} className="cursor-help text-subtle"><Info className="h-3.5 w-3.5" /></span>
                    </div>
                    <p className={`tabular mt-2 text-xl font-semibold ${x.value === null ? (x.infinite ? "text-success" : "text-subtle") : x.format === "money" && x.value < 0 ? "text-danger" : "text-fg"}`}>{fmtMetric(x, currency)}</p>
                    <div className="mt-1 min-h-[18px] text-xs">
                      {change !== null ? <span className={(x.key === "operating_expenses" ? change <= 0 : change >= 0) ? "text-success" : "text-danger"}>{change >= 0 ? "▲" : "▼"} {pct(Math.abs(change))} vs previous</span> : null}
                      {x.value !== null && x.previous !== undefined && x.previous !== null && x.format !== "money" ? <span className="text-muted">Previous: {fmtMetric(x, currency, x.previous)}</span> : null}
                    </div>
                    <p className="mt-auto border-t border-line pt-2 text-[11px] leading-snug text-muted">{x.reason ?? x.formula}</p>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </>
    );
  }

  if (tab === "profitability") {
    const [clients, services] = await Promise.all([clientProfitability(range), serviceProfitability(range)]);
    const table = (rows: { id: string; name: string; revenue: number; cost: number; profit: number; margin: number | null }[], label: string, href?: (id: string) => string) => (
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-line bg-surface-2 text-xs text-muted"><th className="px-4 py-2 text-left">{label}</th><th className="px-4 py-2 text-right">Revenue</th><th className="px-4 py-2 text-right">Attributed cost</th><th className="px-4 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5">{href ? <Link href={href(r.id)} className="text-brand">{r.name}</Link> : r.name}</td>
                <td className="tabular px-4 py-2.5 text-right">{m(r.revenue)}</td>
                <td className="tabular px-4 py-2.5 text-right">{m(r.cost)}</td>
                <td className={`tabular px-4 py-2.5 text-right font-medium ${r.profit < 0 ? "text-danger" : ""}`}>{m(r.profit)}</td>
                <td className="tabular px-4 py-2.5 text-right">{r.margin === null ? <span className="text-subtle">Insufficient Data</span> : pct(r.margin)}</td>
              </tr>
            )) : <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No revenue or attributable costs in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    );
    return (
      <>
        {header}
        {tabs}
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Profit by service" description="Revenue from invoice lines tagged with a service − costs of projects/expenses tagged with that service" />
            <CardBody><RankedBars signed data={services.map((s) => ({ name: s.name, value: s.profit }))} currency={currency} emptyMessage="Tag invoice lines and projects with services to see this." /></CardBody>
            {table(services, "Service")}
          </Card>
          <Card>
            <CardHeader title="Profit by client" description="Revenue − expenses, vendor bills and time cost linked to the client or its projects" />
            <CardBody><RankedBars signed data={clients.slice(0, 10).map((s) => ({ name: s.name, value: s.profit }))} currency={currency} emptyMessage="No client revenue in this period." /></CardBody>
            {table(clients, "Client", (id) => `/billing/clients/${id}`)}
          </Card>
        </div>
        <Notice className="mt-4">Overheads not linked to a client, project or service (rent, salaries without time entries…) are not allocated here — they appear in the company P&amp;L.</Notice>
      </>
    );
  }

  if (tab === "projects") {
    const projects = (await projectProfitability()).filter((p) => !p.revenue.isZero() || !p.totalCost.isZero());
    const unprofitable = projects.filter((p) => p.profit.lt(0));
    return (
      <>
        {header}
        {tabs}
        {unprofitable.length ? <Notice tone="warning" className="mb-4"><b>{unprofitable.length} project(s) are currently unprofitable:</b> {unprofitable.map((p) => p.name).join(", ")}.</Notice> : null}
        <Card className="overflow-hidden">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-xs text-muted"><th className="px-4 py-2 text-left">Project</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-right">Revenue</th><th className="px-4 py-2 text-right">Expenses</th><th className="px-4 py-2 text-right">Time cost</th><th className="px-4 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th><th className="px-4 py-2 text-right">Budget used</th></tr></thead>
              <tbody>
                {projects.length ? projects.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5"><Link className="text-brand" href={`/projects/${p.id}?tab=finance`}>{p.name}</Link><span className="block text-xs text-muted">{p.client?.name ?? "Internal"}</span></td>
                    <td className="px-4 py-2.5"><StatusBadge status={p.status} /></td>
                    <td className="tabular px-4 py-2.5 text-right">{m(num(p.revenue))}</td>
                    <td className="tabular px-4 py-2.5 text-right">{m(num(p.directExpenses))}</td>
                    <td className="tabular px-4 py-2.5 text-right">{m(num(p.timeCost))}<span className="block text-xs text-muted">{p.hours.toFixed(1)} h</span></td>
                    <td className={`tabular px-4 py-2.5 text-right font-medium ${p.profit.lt(0) ? "text-danger" : "text-success"}`}>{m(num(p.profit))}</td>
                    <td className="tabular px-4 py-2.5 text-right">{p.margin === null ? <span className="text-subtle">Insufficient Data</span> : pct(p.margin)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{p.budgetUsed === null ? "—" : <Badge tone={p.budgetUsed > 1 ? "danger" : p.budgetUsed > 0.8 ? "warning" : "neutral"}>{pct(p.budgetUsed, 0)}</Badge>}</td>
                  </tr>
                )) : <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">No project revenue or costs recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  }

  if (tab === "comparisons") {
    const today = todayIST();
    const fyStart = range.fyStartMonth;
    const thisM = { from: startOfMonth(today), to: endOfMonth(today) };
    const lastM = { from: addMonths(thisM.from, -1), to: endOfMonth(addMonths(thisM.from, -1)) };
    const q = quarterOf(today, fyStart);
    const pq = quarterOf(addDays(q.from, -1), fyStart);
    const fy = fyOf(today, fyStart);
    const pfy = fyOf(addDays(fy.from, -1), fyStart);
    const sameMonthLastYear = { from: addMonths(thisM.from, -12), to: endOfMonth(addMonths(thisM.from, -12)) };
    const pairs = [
      { title: "Month on month", a: { ...thisM, label: monthLongLabel(thisM.from) }, b: { ...lastM, label: monthLongLabel(lastM.from) } },
      { title: "Year on year (same month)", a: { ...thisM, label: monthLongLabel(thisM.from) }, b: { ...sameMonthLastYear, label: monthLongLabel(sameMonthLastYear.from) } },
      { title: "Quarter on quarter", a: q, b: pq },
      { title: "Financial year", a: fy, b: pfy },
    ];
    const results = await Promise.all(pairs.map(async (p) => ({ ...p, ra: await getPnl(p.a), rb: await getPnl(p.b) })));
    const lines: { label: string; key: "revenue" | "totalExpenses" | "grossProfit" | "netProfit" | "cashIn" | "cashOut" }[] = [
      { label: "Revenue", key: "revenue" }, { label: "Expenses", key: "totalExpenses" }, { label: "Gross profit", key: "grossProfit" },
      { label: "Net profit", key: "netProfit" }, { label: "Cash in", key: "cashIn" }, { label: "Cash out", key: "cashOut" },
    ];
    return (
      <>
        {header}
        {tabs}
        <div className="grid gap-4 xl:grid-cols-2">
          {results.map((r) => (
            <Card key={r.title}>
              <CardHeader title={r.title} description={`${r.a.label} vs ${r.b.label}${r.title === "Financial year" || r.title.startsWith("Quarter") ? " (current period to date)" : ""}`} />
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line bg-surface-2 text-xs text-muted"><th className="px-4 py-2 text-left">Metric</th><th className="px-4 py-2 text-right">{r.a.label}</th><th className="px-4 py-2 text-right">{r.b.label}</th><th className="px-4 py-2 text-right">Change</th></tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const a = num(r.ra[l.key]);
                    const b = num(r.rb[l.key]);
                    const ch = b !== 0 ? (a - b) / Math.abs(b) : null;
                    const good = l.key === "totalExpenses" || l.key === "cashOut" ? (ch ?? 0) <= 0 : (ch ?? 0) >= 0;
                    return (
                      <tr key={l.key} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5">{l.label}</td>
                        <td className="tabular px-4 py-2.5 text-right">{m(a)}</td>
                        <td className="tabular px-4 py-2.5 text-right text-muted">{m(b)}</td>
                        <td className={`tabular px-4 py-2.5 text-right ${ch === null ? "text-subtle" : good ? "text-success" : "text-danger"}`}>{ch === null ? "Insufficient Data" : `${ch >= 0 ? "+" : ""}${pct(ch)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      </>
    );
  }

  // forecast
  const f = await forecast(3, 12);
  return (
    <>
      {header}
      {tabs}
      {f.ok ? (
        <>
          <Notice tone="warning" className="mb-4">
            <b>Forecast, not fact.</b> {f.method} Fit quality (R²): revenue {f.revenueR2.toFixed(2)}, expenses {f.expenseR2.toFixed(2)} — values near 0 mean the trend explains little of the variation. Use as a directional guide only.
          </Notice>
          <Card className="mb-4">
            <CardHeader title="Revenue & expense trend with 3-month projection" description="Solid = actual (complete months), dashed = projected" />
            <CardBody>
              <TrendLines
                currency={currency}
                zeroLine={false}
                data={[
                  ...f.history.map((h) => ({ label: h.label, revenue: h.revenue, expenses: h.expenses })),
                  ...f.projections.map((p) => ({ label: `${p.label}*`, revenueF: p.revenue, expensesF: p.expenses })),
                ].map((row, i, arr) => {
                  // Connect the projection to the last actual point.
                  const lastActual = f.history.length - 1;
                  if (i === lastActual) return { ...row, revenueF: (row as { revenue: number }).revenue, expensesF: (row as { expenses: number }).expenses };
                  return row as typeof arr[number];
                })}
                series={[
                  { key: "revenue", name: "Revenue (actual)", colorIndex: 0 },
                  { key: "revenueF", name: "Revenue (forecast)", dashed: true, colorIndex: 0 },
                  { key: "expenses", name: "Expenses (actual)", colorIndex: 1 },
                  { key: "expensesF", name: "Expenses (forecast)", dashed: true, colorIndex: 1 },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Projected months" />
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-surface-2 text-xs text-muted"><th className="px-4 py-2 text-left">Month</th><th className="px-4 py-2 text-right">Revenue (forecast)</th><th className="px-4 py-2 text-right">Expenses (forecast)</th><th className="px-4 py-2 text-right">Profit (forecast)</th></tr></thead>
              <tbody>
                {f.projections.map((p) => (
                  <tr key={p.month} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{p.label}</td>
                    <td className="tabular px-4 py-2.5 text-right">{m(p.revenue)}</td>
                    <td className="tabular px-4 py-2.5 text-right">{m(p.expenses)}</td>
                    <td className={`tabular px-4 py-2.5 text-right ${p.profit < 0 ? "text-danger" : ""}`}>{m(p.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <Card><CardBody><p className="text-sm font-semibold">Insufficient Data</p><p className="mt-1 text-sm text-muted">{f.reason} {f.history.length ? `Currently ${f.history.length} month(s) available.` : ""}</p></CardBody></Card>
      )}
    </>
  );
}
