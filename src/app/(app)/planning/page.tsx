import { Pencil, Plus, Target, Trash2 } from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { param, withParams, type SearchParams } from "@/lib/list";
import { getDisplayCurrency, getSettings } from "@/lib/settings";
import { formatMoney, num } from "@/lib/money";
import { addMonths, fmtDate, isoDate, periodBounds, startOfMonth, todayIST, fyOf, daysBetween } from "@/lib/dates";
import { categoryOptions, serviceOptions } from "@/lib/options";
import { goalProgress, GOAL_METRICS } from "@/lib/finance/goals";
import { loadPeriod } from "@/lib/finance/reports";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Progress } from "@/components/ui/primitives";
import { LinkTabs } from "@/components/ui/data-table";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteBudget, deleteGoal, saveBudget, saveGoal } from "@/server/actions/planning";
import { pct } from "@/lib/utils";

export const metadata = { title: "Planning & Goals" };

const PERIODS = [{ value: "MONTH", label: "Month" }, { value: "QUARTER", label: "Quarter (FY)" }, { value: "YEAR", label: "Financial year" }];

export default async function PlanningPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("planning");
  const sp = await searchParams;
  const tab = param(sp, "tab") === "budgets" ? "budgets" : "goals";
  const show = param(sp, "show") ?? "current";
  const currency = await getDisplayCurrency();
  const settings = await getSettings();
  const today = todayIST();
  const canEdit = can(user.access, "planning", "EDIT");
  const [services, categories] = await Promise.all([serviceOptions(), categoryOptions("EXPENSE")]);

  const goalFields: FieldDef[] = [
    { name: "title", label: "Goal", required: true, span: 2, placeholder: "e.g. ₹10L revenue this quarter" },
    { name: "metric", label: "Measure", type: "select", options: GOAL_METRICS.map((g) => ({ value: g.value, label: `${g.label} — ${g.help}` })), emptyOption: false, span: 2 },
    { name: "periodType", label: "Period", type: "select", options: PERIODS, emptyOption: false },
    { name: "periodStart", label: "Any date in the period", type: "date", required: true, hint: "Snaps to the month / FY quarter / FY" },
    { name: "target", label: "Target", type: "money", required: true, hint: "₹ for money goals, a number for counts, % for retention" },
    { name: "serviceId", label: "Service (for service revenue)", type: "select", options: services },
    { name: "manualActual", label: "Actual (custom goals only)", type: "money" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
  const budgetFields: FieldDef[] = [
    { name: "categoryId", label: "Expense category", type: "select", options: categories, required: true, span: 2 },
    { name: "periodType", label: "Period", type: "select", options: PERIODS, emptyOption: false },
    { name: "periodStart", label: "Any date in the period", type: "date", required: true },
    { name: "amount", label: "Budget (₹)", type: "money", required: true },
    { name: "notes", label: "Notes", type: "textarea" },
  ];

  const header = (
    <PageHeader
      title="Planning & Goals"
      description="Set revenue targets, profit goals and expense budgets — progress is measured against your actual books."
      actions={canEdit ? (
        tab === "goals"
          ? <FormDialog trigger={<><Plus /> New goal</>} title="New goal" fields={goalFields} defaults={{ metric: "REVENUE", periodType: "MONTH", periodStart: isoDate(today) }} action={saveGoal.bind(null, null)} size="lg" />
          : <FormDialog trigger={<><Plus /> New budget</>} title="New expense budget" fields={budgetFields} defaults={{ periodType: "MONTH", periodStart: isoDate(today) }} action={saveBudget.bind(null, null)} />
      ) : null}
    />
  );
  const tabs = (
    <LinkTabs active={tab} tabs={[
      { key: "goals", label: "Goals & targets", href: withParams("/planning", sp, { tab: null }) },
      { key: "budgets", label: "Expense budgets", href: withParams("/planning", sp, { tab: "budgets" }) },
    ]} />
  );

  if (tab === "goals") {
    const goals = await db.financialGoal.findMany({
      where: show === "past" ? { periodEnd: { lt: today } } : show === "upcoming" ? { periodStart: { gt: today } } : { periodStart: { lte: today }, periodEnd: { gte: today } },
      include: { service: true },
      orderBy: [{ periodStart: "desc" }, { createdAt: "asc" }],
    });
    const progress = await Promise.all(goals.map((g) => goalProgress(g)));
    return (
      <>
        {header}
        {tabs}
        <div className="mb-4 flex gap-2 text-[13px]">
          {[["current", "Current"], ["upcoming", "Upcoming"], ["past", "Past"]].map(([k, l]) => (
            <a key={k} href={withParams("/planning", sp, { show: k === "current" ? null : k })} className={`rounded-full border px-3 py-1 ${show === k ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>{l}</a>
          ))}
        </div>
        {goals.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {goals.map((g, i) => {
              const p = progress[i]!;
              const meta = GOAL_METRICS.find((m) => m.value === g.metric)!;
              const fmt = (v: number) => (meta.unit === "money" ? formatMoney(v, { currency }) : meta.unit === "percent" ? `${v.toFixed(1)}%` : v.toLocaleString("en-IN"));
              const elapsed = Math.min(1, Math.max(0, (daysBetween(g.periodStart, today) + 1) / (daysBetween(g.periodStart, g.periodEnd) + 1)));
              return (
                <Card key={g.id} className="flex flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{g.title}</p>
                      <p className="text-xs text-muted">{meta.label}{g.service ? ` · ${g.service.name}` : ""} · {fmtDate(g.periodStart)} – {fmtDate(g.periodEnd)}</p>
                    </div>
                    {p.onTrack === null ? <Badge>Insufficient Data</Badge> : p.onTrack ? <Badge tone="success">{meta.lowerIsBetter ? "Within limit" : "Achieved"}</Badge> : <Badge tone={meta.lowerIsBetter ? "danger" : "warning"}>{meta.lowerIsBetter ? "Over limit" : "In progress"}</Badge>}
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <p className="tabular text-2xl font-semibold">{p.actual === null ? "—" : fmt(p.actual)}</p>
                    <p className="text-sm text-muted">of {fmt(num(g.target))}</p>
                  </div>
                  <Progress className="mt-2" value={p.ratio ?? 0} tone={p.onTrack === null ? "brand" : meta.lowerIsBetter ? (p.ratio! > 1 ? "danger" : p.ratio! > elapsed ? "warning" : "success") : p.ratio! >= 1 ? "success" : p.ratio! >= elapsed ? "brand" : "warning"} />
                  <p className="mt-1.5 text-xs text-muted">
                    {p.ratio === null ? p.reason : `${pct(p.ratio, 0)} ${meta.lowerIsBetter ? "of the cap used" : "of target"} · ${pct(elapsed, 0)} of the period elapsed`}
                  </p>
                  {g.notes ? <p className="mt-2 text-xs text-muted">{g.notes}</p> : null}
                  {canEdit ? (
                    <div className="mt-auto flex justify-end gap-1 pt-3">
                      <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit goal" fields={goalFields} defaults={{ title: g.title, metric: g.metric, periodType: g.periodType, periodStart: isoDate(g.periodStart), target: g.target.toFixed(2), serviceId: g.serviceId, manualActual: g.manualActual?.toFixed(2), notes: g.notes }} action={saveGoal.bind(null, g.id)} size="lg" />
                      {can(user.access, "planning", "FULL") ? <ConfirmAction action={deleteGoal.bind(null, g.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete goal?" confirmLabel="Delete" /> : null}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        ) : (
          <Card><EmptyState icon={<Target />} title={`No ${show} goals`} description="Create monthly, quarterly or annual targets for revenue, profit, retention and more." /></Card>
        )}
      </>
    );
  }

  // Budgets: current month / quarter / FY
  const periods = (["MONTH", "QUARTER", "YEAR"] as const).map((t) => ({ type: t, ...periodBounds(t, today, settings.fyStartMonth) }));
  const selected = periods.find((p) => p.type === (param(sp, "period") ?? "MONTH")) ?? periods[0]!;
  const budgets = await db.budget.findMany({ where: { periodType: selected.type, periodStart: selected.from }, include: { category: true }, orderBy: { category: { name: "asc" } } });
  const { entries } = await loadPeriod({ from: selected.from, to: selected.to });
  const spentBy = (categoryId: string) => entries.filter((e) => e.categoryId === categoryId && (e.bucket === "COS" || e.bucket === "OPEX" || e.bucket === "NONOP")).reduce((a, e) => a + num(e.amount), 0);
  const totalBudget = budgets.reduce((a, b) => a + num(b.amount), 0);
  const totalSpent = budgets.reduce((a, b) => a + spentBy(b.categoryId), 0);
  const prevMonthStart = startOfMonth(addMonths(today, -1));
  return (
    <>
      {header}
      {tabs}
      <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
        {periods.map((p) => (
          <a key={p.type} href={withParams("/planning", sp, { period: p.type })} className={`rounded-full border px-3 py-1 ${selected.type === p.type ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>{p.label}</a>
        ))}
      </div>
      <Card>
        <CardHeader title={`Budget vs actual — ${selected.label}`} description={budgets.length ? `${formatMoney(totalSpent, { currency })} spent of ${formatMoney(totalBudget, { currency })} budgeted` : undefined} />
        {budgets.length ? (
          <ul className="divide-y divide-line">
            {budgets.map((b) => {
              const spent = spentBy(b.categoryId);
              const ratio = spent / num(b.amount);
              return (
                <li key={b.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="w-56 shrink-0">
                    <p className="text-sm font-medium">{b.category.name}</p>
                    <p className="text-xs text-muted">{formatMoney(spent, { currency })} of {formatMoney(b.amount, { currency })}</p>
                  </div>
                  <div className="flex flex-1 items-center gap-3">
                    <Progress value={ratio} tone={ratio > 1 ? "danger" : ratio > 0.85 ? "warning" : "success"} />
                    <span className={`w-14 text-right text-xs ${ratio > 1 ? "font-semibold text-danger" : "text-muted"}`}>{pct(ratio, 0)}</span>
                  </div>
                  {canEdit ? (
                    <div className="flex gap-1">
                      <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit budget" fields={budgetFields} defaults={{ categoryId: b.categoryId, periodType: b.periodType, periodStart: isoDate(b.periodStart), amount: b.amount.toFixed(2), notes: b.notes }} action={saveBudget.bind(null, b.id)} />
                      {can(user.access, "planning", "FULL") ? <ConfirmAction action={deleteBudget.bind(null, b.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete budget?" confirmLabel="Delete" /> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={<Target />} title={`No budgets for ${selected.label}`} description={`Set spending limits per expense category. Tip: last month (${fmtDate(prevMonthStart)}) actuals are in Finance → Statements.`} />
        )}
        <CardBody className="border-t border-line text-xs text-muted">Actuals use accrual expenses (net of claimable GST) for the category in {selected.label}. {fyOf(today, settings.fyStartMonth).label}.</CardBody>
      </Card>
    </>
  );
}
