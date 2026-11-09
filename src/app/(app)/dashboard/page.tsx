import Link from "next/link";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, Briefcase, CalendarClock, CheckCircle2, Circle, FileWarning,
  Landmark, ListTodo, Receipt, RefreshCw, TrendingUp, Users, Wallet,
} from "lucide-react";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getDisplayCurrency, getSettings } from "@/lib/settings";
import { pageRange } from "@/lib/page-range";
import { addDays, addMonths, endOfMonth, fmtDate, isoDate, startOfMonth, todayIST, daysBetween } from "@/lib/dates";
import { formatMoney, num, D } from "@/lib/money";
import { getMonthlySeries, getPayables, getPnl, getReceivables, expenseByCategory, revenueByService, projectProfitability } from "@/lib/finance/reports";
import { getMrr } from "@/lib/finance/metrics";
import { totalCash, invoiceOutstanding } from "@/lib/finance/ledger";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/status-badge";
import { RangeFilter } from "@/components/range-filter";
import { CashFlowChart, GroupedBars, RankedBars, TrendLines } from "@/components/charts";
import type { SearchParams } from "@/lib/list";

export const metadata = { title: "Overview Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("dashboard");
  const sp = await searchParams;
  const range = await pageRange(sp);
  const currency = await getDisplayCurrency();
  const settings = await getSettings();
  const today = todayIST();
  const money = (v: unknown, compact = true) => formatMoney(v as number, { currency, compact });

  // Charts need some history: use the selected range if it spans ≥3 months, else the last 6 months.
  const months = (range.to.getUTCFullYear() - range.from.getUTCFullYear()) * 12 + range.to.getUTCMonth() - range.from.getUTCMonth() + 1;
  const chartRange = months >= 3 ? { from: range.from, to: range.to } : { from: startOfMonth(addMonths(range.to, -5)), to: endOfMonth(range.to) };
  const thisMonth = { from: startOfMonth(today), to: endOfMonth(today) };

  const [pnl, monthPnl, series, receivables, payables, cash, mrr, byService, byCategory, projects] = await Promise.all([
    getPnl(range),
    getPnl(thisMonth),
    getMonthlySeries(chartRange),
    getReceivables(today),
    getPayables(today),
    totalCash(today),
    getMrr(),
    revenueByService(range),
    expenseByCategory(range),
    projectProfitability(undefined, undefined),
  ]);

  const in30 = addDays(today, 30);
  const [
    activeClients, activeProjects, completedProjects, pendingTasks, renewals, pendingInvoices, recentTxns, overdue,
    upcomingBills, upcomingSubs, recentDocs, projectDeadlines, taskDeadlines, alerts, accountsCount, clientsCount,
  ] = await Promise.all([
    db.client.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    db.project.count({ where: { deletedAt: null, status: "IN_PROGRESS" } }),
    db.project.count({ where: { deletedAt: null, status: "COMPLETED", completedAt: { gte: range.from, lte: addDays(range.to, 1) } } }),
    db.task.count({ where: { deletedAt: null, status: { not: "DONE" } } }),
    db.subscription.count({ where: { deletedAt: null, status: "ACTIVE", renewalDate: { gte: today, lte: in30 } } }),
    db.invoice.count({ where: { deletedAt: null, status: { in: ["DRAFT", "ISSUED", "PARTIALLY_PAID"] }, type: { not: "CREDIT_NOTE" } } }),
    db.transaction.findMany({ where: { deletedAt: null }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 6, include: { category: true } }),
    db.invoice.findMany({
      where: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, type: { not: "CREDIT_NOTE" }, dueDate: { lt: today } },
      orderBy: { dueDate: "asc" },
      take: 6,
    }),
    db.vendorBill.findMany({ where: { deletedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] }, dueDate: { lte: addDays(today, 14) } }, include: { vendor: true }, orderBy: { dueDate: "asc" }, take: 5 }),
    db.subscription.findMany({ where: { deletedAt: null, status: "ACTIVE", renewalDate: { lte: addDays(today, 14) } }, orderBy: { renewalDate: "asc" }, take: 5 }),
    can(user.access, "vault") ? db.document.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5 }) : Promise.resolve([]),
    db.project.findMany({ where: { deletedAt: null, status: { in: ["PLANNING", "NOT_STARTED", "IN_PROGRESS"] }, endDate: { not: null, lte: addDays(today, 21) } }, orderBy: { endDate: "asc" }, take: 5 }),
    db.task.findMany({ where: { deletedAt: null, status: { not: "DONE" }, dueDate: { not: null, lte: addDays(today, 7) } }, include: { project: true }, orderBy: { dueDate: "asc" }, take: 5 }),
    db.notification.findMany({ where: { userId: user.id, readAt: null, severity: { in: ["WARNING", "CRITICAL"] } }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.account.count(),
    db.client.count({ where: { deletedAt: null } }),
  ]);

  const setup = [
    { done: !!(settings.addressLine1 && settings.stateCode), label: "Add company address & state", href: "/settings" },
    { done: settings.gstRegistered ? !!settings.gstin : true, label: "Confirm GST registration status", href: "/settings" },
    { done: accountsCount > 0, label: "Add your bank / cash accounts", href: "/finance/accounts" },
    { done: clientsCount > 0, label: "Add or import clients", href: "/billing/clients" },
  ];
  const setupPending = setup.filter((s) => !s.done);

  const upcoming = [
    ...upcomingBills.map((b) => ({ key: `b-${b.id}`, date: b.dueDate!, label: `${b.vendor.name} — bill ${b.billNumber}`, amount: D(b.total).minus(D(b.amountPaid)), href: "/vendors/bills" })),
    ...upcomingSubs.map((s) => ({ key: `s-${s.id}`, date: s.renewalDate, label: `${s.name} renewal`, amount: D(s.cost), href: "/subscriptions" })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const deadlines = [
    ...projectDeadlines.map((p) => ({ key: `p-${p.id}`, date: p.endDate!, label: p.name, kind: "Project", href: `/projects/${p.id}` })),
    ...taskDeadlines.map((t) => ({ key: `t-${t.id}`, date: t.dueDate!, label: t.title, kind: t.project.name, href: `/projects/${t.projectId}?tab=tasks` })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 7);

  const profitTone = num(pnl.netProfit) >= 0 ? "success" : "danger";

  return (
    <>
      <PageHeader
        title={`Good ${greeting()}, ${user.name.split(" ")[0]}`}
        description={`${range.label} · figures in ${currency.code}${currency.code !== "INR" ? ` (converted from INR at 1 ${currency.code} = ₹${currency.rateToInr.toFixed(2)}, ${currency.source === "ecb" ? "ECB" : "manual"} rate of ${currency.asOf})` : ""}`}
        actions={<RangeFilter preset={range.preset} from={range.fromIso} to={range.toIso} />}
      />

      {setupPending.length ? (
        <Card className="mb-6 border-brand/30">
          <CardHeader title="Finish setting up" description="Complete these steps so invoices, reports and metrics are accurate." />
          <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {setup.map((s) => (
              <Link key={s.label} href={s.href} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-[13px] hover:bg-surface-2">
                {s.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-subtle" />}
                <span className={s.done ? "text-muted line-through" : "text-fg"}>{s.label}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <section aria-label="Financial KPIs" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Revenue" value={money(pnl.revenue)} icon={<TrendingUp />} hint={`${range.label} · invoiced, excl. GST`} href="/finance/statements" />
        <StatCard label="Monthly Revenue" value={money(monthPnl.revenue)} icon={<Banknote />} hint="This month · invoiced, excl. GST" />
        <StatCard label="MRR" value={mrr.profiles ? money(mrr.mrr) : "Insufficient Data"} icon={<RefreshCw />} hint={mrr.profiles ? `${mrr.profiles} recurring profile(s)` : "No active recurring invoices"} href="/billing/recurring" />
        <StatCard label="Total Expenses" value={money(pnl.totalExpenses)} icon={<ArrowDownRight />} hint={range.label} href="/finance/transactions?type=EXPENSE" />
        <StatCard label="Net Profit" value={money(pnl.netProfit)} tone={profitTone} icon={<ArrowUpRight />} hint={`Accrual basis · cash received ${money(pnl.clientReceipts)}`} href="/finance/statements" />
        <StatCard label="Outstanding Receivables" value={money(receivables.total)} icon={<Receipt />} hint={`${receivables.rows.length} unpaid invoice(s)`} href="/finance/statements?tab=receivables" />
        <StatCard label="Accounts Payable" value={money(payables.total)} icon={<FileWarning />} hint={`${payables.rows.length} unpaid bill(s)`} href="/finance/statements?tab=payables" />
        <StatCard label="Cash Balance" value={money(cash)} icon={<Wallet />} hint="All bank & cash accounts today" href="/finance/accounts" />
      </section>

      <section aria-label="Operational KPIs" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat icon={<Users />} label="Active Clients" value={activeClients} href="/billing/clients?status=ACTIVE" />
        <MiniStat icon={<Briefcase />} label="Active Projects" value={activeProjects} href="/projects?status=IN_PROGRESS" />
        <MiniStat icon={<CheckCircle2 />} label="Projects Completed" value={completedProjects} hint={range.label} href="/projects?status=COMPLETED" />
        <MiniStat icon={<ListTodo />} label="Pending Tasks" value={pendingTasks} href="/projects/tasks" />
        <MiniStat icon={<CalendarClock />} label="Upcoming Renewals" value={renewals} hint="Next 30 days" href="/subscriptions" />
        <MiniStat icon={<Landmark />} label="Pending Invoices" value={pendingInvoices} hint="Draft + unpaid" href="/billing/invoices?status=OPEN" />
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Revenue vs Expenses" description={`Monthly, accrual basis · ${months >= 3 ? range.label : "last 6 months"}`} />
          <CardBody>
            <GroupedBars data={series} series={[{ key: "revenue", name: "Revenue" }, { key: "expenses", name: "Expenses" }]} currency={currency} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Profit & Loss Trend" description="Monthly net profit (accrual basis)" />
          <CardBody>
            <TrendLines data={series} series={[{ key: "profit", name: "Net profit" }]} currency={currency} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Monthly Cash Flow" description="Actual money in and out of your accounts" />
          <CardBody>
            <CashFlowChart data={series} currency={currency} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Project Profitability" description="Top projects · revenue − (expenses + time cost), all time" action={<Link href="/intelligence?tab=projects" className="text-[13px] text-brand hover:underline">Details</Link>} />
          <CardBody>
            <RankedBars
              signed
              data={projects.filter((p) => !p.revenue.isZero() || !p.totalCost.isZero()).slice(0, 8).map((p) => ({ name: p.name, value: num(p.profit) }))}
              currency={currency}
              emptyMessage="No project revenue or costs recorded yet."
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Revenue by Service" description={`${range.label} · from invoice line items`} />
          <CardBody>
            <RankedBars data={byService.slice(0, 8).map((s) => ({ name: s.name, value: s.amount }))} currency={currency} emptyMessage="No invoiced revenue in this period." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Expense by Category" description={range.label} />
          <CardBody>
            <RankedBars data={byCategory.slice(0, 8).map((s) => ({ name: s.name, value: s.amount }))} currency={currency} colorIndex={1} emptyMessage="No expenses in this period." />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Widget title="Important Alerts" href="/notifications">
          {alerts.length ? (
            alerts.map((a) => (
              <WidgetRow key={a.id} href={a.link ?? "/notifications"} left={<span className="flex items-center gap-2"><AlertTriangle className={a.severity === "CRITICAL" ? "h-4 w-4 text-danger" : "h-4 w-4 text-warning"} />{a.title}</span>} />
            ))
          ) : (
            <EmptyState title="No alerts" description="Nothing needs your attention right now." className="py-8" />
          )}
        </Widget>
        <Widget title="Overdue Invoices" href="/billing/invoices?status=OVERDUE">
          {overdue.length ? (
            overdue.map((i) => (
              <WidgetRow key={i.id} href={`/billing/invoices/${i.id}`} left={<><span className="font-medium">{i.number}</span><span className="block text-xs text-muted">{i.clientName} · {daysBetween(i.dueDate!, today)} days overdue</span></>} right={formatMoney(invoiceOutstanding(i))} />
            ))
          ) : (
            <EmptyState title="No overdue invoices" className="py-8" />
          )}
        </Widget>
        <Widget title="Upcoming Payments" href="/vendors/bills">
          {upcoming.length ? (
            upcoming.slice(0, 6).map((u) => (
              <WidgetRow key={u.key} href={u.href} left={<><span>{u.label}</span><span className="block text-xs text-muted">{fmtDate(u.date)}</span></>} right={formatMoney(u.amount)} />
            ))
          ) : (
            <EmptyState title="Nothing due in the next 14 days" className="py-8" />
          )}
        </Widget>
        <Widget title="Recent Transactions" href="/finance/transactions">
          {recentTxns.length ? (
            recentTxns.map((t) => (
              <WidgetRow
                key={t.id}
                href={`/finance/transactions?q=${encodeURIComponent(t.description)}`}
                left={<><span className="line-clamp-1">{t.description}</span><span className="block text-xs text-muted">{fmtDate(t.date)} · {t.category?.name ?? t.type.toLowerCase()}</span></>}
                right={<span className={t.type === "INCOME" ? "text-success" : t.type === "EXPENSE" ? "text-danger" : "text-muted"}>{t.type === "EXPENSE" ? "−" : t.type === "INCOME" ? "+" : ""}{formatMoney(t.amount)}</span>}
              />
            ))
          ) : (
            <EmptyState title="No transactions yet" className="py-8" />
          )}
        </Widget>
        <Widget title="Upcoming Deadlines" href="/projects/calendar">
          {deadlines.length ? (
            deadlines.map((d) => (
              <WidgetRow key={d.key} href={d.href} left={<><span className="line-clamp-1">{d.label}</span><span className="block text-xs text-muted">{d.kind}</span></>} right={<Badge tone={d.date < today ? "danger" : daysBetween(today, d.date) <= 2 ? "warning" : "neutral"}>{fmtDate(d.date)}</Badge>} />
            ))
          ) : (
            <EmptyState title="No deadlines this week" className="py-8" />
          )}
        </Widget>
        <Widget title="Recent Documents" href="/vault">
          {recentDocs.length ? (
            recentDocs.map((d) => (
              <WidgetRow key={d.id} href={`/vault?q=${encodeURIComponent(d.title)}`} left={<><span className="line-clamp-1">{d.title}</span><span className="block text-xs text-muted">{d.category.replace(/_/g, " ").toLowerCase()}</span></>} right={<span className="text-xs text-muted">{fmtDate(isoDate(d.createdAt))}</span>} />
            ))
          ) : (
            <EmptyState title="No documents uploaded" className="py-8" />
          )}
        </Widget>
      </div>
      <p className="mt-6 text-xs text-muted">
        Revenue is recognised on invoice date (taxable value, excl. GST). Cash figures come from bank &amp; cash account transactions. <StatusBadge status="INFO" label="Accrual" /> vs <StatusBadge status="INCOME" label="Cash" /> are always shown separately.
      </p>
    </>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function MiniStat({ icon, label, value, hint, href }: { icon: React.ReactNode; label: string; value: number; hint?: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow)] hover:border-line-strong">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span className="min-w-0">
        <span className="tabular block text-lg font-semibold leading-tight text-fg">{value}</span>
        <span className="block truncate text-xs text-muted">{label}{hint ? ` · ${hint}` : ""}</span>
      </span>
    </Link>
  );
}

function Widget({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} action={<Link href={href} className="text-[13px] text-brand hover:underline">View all</Link>} />
      <ul className="divide-y divide-line">{children}</ul>
    </Card>
  );
}

function WidgetRow({ left, right, href }: { left: React.ReactNode; right?: React.ReactNode; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px] text-fg hover:bg-surface-2">
        <span className="min-w-0">{left}</span>
        {right ? <span className="tabular shrink-0 font-medium">{right}</span> : null}
      </Link>
    </li>
  );
}
