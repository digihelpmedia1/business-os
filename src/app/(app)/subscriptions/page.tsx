import { Globe, Package, Pencil, Plus, RefreshCw, Trash2, Download } from "lucide-react";
import type { Prisma, Subscription } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, type SearchParams } from "@/lib/list";
import { D, Decimal, formatMoney } from "@/lib/money";
import { daysBetween, fmtDate, isoDate, todayIST, addDays } from "@/lib/dates";
import { accountOptions, categoryOptions, PAYMENT_METHOD_OPTIONS, vendorOptions, type Option } from "@/lib/options";
import { monthlyFactor } from "@/lib/finance/engine";
import { PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog, type FieldDef } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { deleteSubscription, renewSubscription, saveSubscription } from "@/server/actions/assets";
import { SUPPORTED_CURRENCIES } from "@/lib/money";

export const metadata = { title: "Subscriptions & Domains" };

const KINDS: Option[] = [
  { value: "SOFTWARE", label: "Software / SaaS" }, { value: "HOSTING", label: "Hosting" }, { value: "DOMAIN", label: "Domain" }, { value: "AI_TOOL", label: "AI tool" },
  { value: "MARKETING_TOOL", label: "Marketing tool" }, { value: "SERVICE", label: "Service / retainer" }, { value: "OTHER", label: "Other" },
];
const CYCLES: Option[] = [{ value: "MONTHLY", label: "Monthly" }, { value: "QUARTERLY", label: "Quarterly" }, { value: "HALF_YEARLY", label: "Half-yearly" }, { value: "YEARLY", label: "Yearly" }, { value: "BIENNIAL", label: "Every 2 years" }];

function fields(o: { vendors: Option[]; accounts: Option[]; categories: Option[] }): FieldDef[] {
  return [
    { name: "name", label: "Name", required: true, placeholder: "Google Workspace, Canva Pro…" },
    { name: "provider", label: "Provider" },
    { name: "kind", label: "Type", type: "select", options: KINDS, emptyOption: false },
    { name: "planName", label: "Plan" },
    { name: "billingCycle", label: "Billing cycle", type: "select", options: CYCLES, emptyOption: false },
    { name: "cost", label: "Cost per cycle (₹)", type: "money", required: true, hint: "INR actually charged" },
    { name: "originalCurrency", label: "Billed in currency", type: "select", options: SUPPORTED_CURRENCIES.filter((c) => c !== "INR").map((c) => ({ value: c, label: c })), emptyOption: "INR" },
    { name: "originalAmount", label: "Amount in that currency", type: "money" },
    { name: "startDate", label: "Start date", type: "date" },
    { name: "renewalDate", label: "Next renewal date", type: "date", required: true },
    { name: "paymentMethod", label: "Payment method", type: "select", options: PAYMENT_METHOD_OPTIONS },
    { name: "accountId", label: "Charged to account", type: "select", options: o.accounts },
    { name: "vendorId", label: "Vendor", type: "select", options: o.vendors },
    { name: "categoryId", label: "Expense category", type: "select", options: o.categories },
    { name: "domainName", label: "Domain name", placeholder: "For domains / hosting" },
    { name: "seats", label: "Seats / users", type: "number" },
    { name: "status", label: "Status", type: "select", emptyOption: false, options: [{ value: "ACTIVE", label: "Active" }, { value: "PAUSED", label: "Paused" }, { value: "CANCELLED", label: "Cancelled" }, { value: "EXPIRED", label: "Expired" }] },
    { name: "autoRenew", label: "Auto-renews", type: "checkbox" },
    { name: "notes", label: "Notes", type: "textarea" },
  ];
}

function defaults(s: Subscription) {
  return {
    name: s.name, provider: s.provider, kind: s.kind, planName: s.planName, billingCycle: s.billingCycle, cost: s.cost.toFixed(2), originalCurrency: s.originalCurrency,
    originalAmount: s.originalAmount?.toFixed(2), startDate: isoDate(s.startDate), renewalDate: isoDate(s.renewalDate), paymentMethod: s.paymentMethod, accountId: s.accountId,
    vendorId: s.vendorId, categoryId: s.categoryId, domainName: s.domainName, seats: s.seats, status: s.status, autoRenew: s.autoRenew, notes: s.notes,
  };
}

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("assets");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["renewalDate", "name", "cost"] as const, defaultSort: "renewalDate", defaultDir: "asc", pageSize: 50 });
  const kind = param(sp, "kind");
  const status = param(sp, "status") ?? "ACTIVE";
  const due = param(sp, "due");
  const today = todayIST();
  const where: Prisma.SubscriptionWhereInput = {
    deletedAt: null,
    ...(status !== "ALL" ? { status: status as "ACTIVE" } : {}),
    ...(kind ? { kind: kind as "SOFTWARE" } : {}),
    ...(due === "30" ? { renewalDate: { lte: addDays(today, 30) } } : {}),
    ...(list.q ? { OR: [{ name: { contains: list.q, mode: "insensitive" } }, { provider: { contains: list.q, mode: "insensitive" } }, { domainName: { contains: list.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, active, vendors, accounts, categories] = await Promise.all([
    db.subscription.findMany({ where, include: { vendor: { select: { name: true } } }, orderBy: { [list.sort]: list.dir }, skip: list.skip, take: list.pageSize }),
    db.subscription.count({ where }),
    db.subscription.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { cost: true, billingCycle: true, renewalDate: true, kind: true } }),
    vendorOptions(),
    accountOptions(),
    categoryOptions("EXPENSE"),
  ]);
  const monthly = active.reduce((a, s) => a.plus(D(s.cost).times(monthlyFactor(s.billingCycle))), new Decimal(0));
  const next30 = active.filter((s) => s.renewalDate <= addDays(today, 30));
  const o = { vendors, accounts, categories };
  const canEdit = can(user.access, "assets", "EDIT");
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "name", header: "Subscription", sortKey: "name", render: (s) => <span><span className="flex items-center gap-1.5">{s.kind === "DOMAIN" || s.kind === "HOSTING" ? <Globe className="h-3.5 w-3.5 text-muted" /> : null}{s.name}</span><span className="text-xs text-muted">{[s.provider ?? s.vendor?.name, s.planName, s.domainName].filter(Boolean).join(" · ")}</span></span> },
    { key: "kind", header: "Type", render: (s) => <Badge>{KINDS.find((k) => k.value === s.kind)?.label}</Badge> },
    { key: "cost", header: "Cost", sortKey: "cost", align: "right", render: (s) => <span>{formatMoney(s.cost)}<span className="block text-xs text-muted">{s.billingCycle.replace("_", "-").toLowerCase()}{s.originalCurrency && s.originalAmount ? ` · ${s.originalCurrency} ${s.originalAmount.toFixed(2)}` : ""}</span></span> },
    {
      key: "renew", header: "Renewal", sortKey: "renewalDate",
      render: (s) => {
        const d = daysBetween(today, s.renewalDate);
        return <span><span className={d < 0 ? "font-medium text-danger" : d <= 7 ? "font-medium text-warning" : ""}>{fmtDate(s.renewalDate)}</span><span className="block text-xs text-muted">{s.status !== "ACTIVE" ? "—" : d < 0 ? `${-d} days overdue` : d === 0 ? "today" : `in ${d} days`}{s.autoRenew ? " · auto" : " · manual"}</span></span>;
      },
    },
    { key: "status", header: "Status", render: (s) => <StatusBadge status={s.status} /> },
    {
      key: "a", header: "", align: "right",
      render: (s) => canEdit ? (
        <div className="flex justify-end gap-1">
          {s.status === "ACTIVE" ? <FormDialog trigger={<RefreshCw />} triggerVariant="ghost" triggerSize="icon-sm" title={`Record renewal — ${s.name}`} description="Creates the expense and moves the renewal date one cycle ahead."
            fields={[{ name: "date", label: "Payment date", type: "date", required: true }, { name: "amount", label: "Amount paid (₹)", type: "money", required: true }, { name: "taxAmount", label: "Claimable input GST (₹)", type: "money" }, { name: "accountId", label: "Paid from", type: "select", options: accounts, required: true }, { name: "reference", label: "Reference", span: 2 }]}
            defaults={{ date: isoDate(today), amount: s.cost.toFixed(2), taxAmount: "0", accountId: s.accountId ?? accounts[0]?.value }} action={renewSubscription.bind(null, s.id)} submitLabel="Record renewal" /> : null}
          <FormDialog trigger={<Pencil />} triggerVariant="ghost" triggerSize="icon-sm" title="Edit subscription" fields={fields(o)} defaults={defaults(s)} action={saveSubscription.bind(null, s.id)} size="lg" />
          {can(user.access, "assets", "FULL") ? <ConfirmAction action={deleteSubscription.bind(null, s.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete subscription?" message="Past payments stay in Finance." confirmLabel="Delete" /> : null}
        </div>
      ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        title="Subscriptions & Domains"
        description="Software, AI tools, hosting and domains — with renewal reminders."
        actions={
          <>
            <LinkButton href="/api/export/subscriptions" variant="outline"><Download /> CSV</LinkButton>
            {canEdit ? <FormDialog trigger={<><Plus /> Add subscription</>} title="Add subscription" fields={fields(o)} defaults={{ kind: "SOFTWARE", billingCycle: "MONTHLY", status: "ACTIVE", autoRenew: true, renewalDate: isoDate(addDays(today, 30)) }} action={saveSubscription.bind(null, null)} size="lg" /> : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Monthly cost" value={formatMoney(monthly)} hint="Active, normalised to a month" />
        <StatCard label="Annual cost" value={formatMoney(monthly.times(12))} />
        <StatCard label="Renewing in 30 days" value={next30.length} hint={formatMoney(next30.reduce((a, s) => a.plus(D(s.cost)), new Decimal(0)))} href="/subscriptions?due=30" />
        <StatCard label="Domains & hosting" value={active.filter((s) => s.kind === "DOMAIN" || s.kind === "HOSTING").length} href="/subscriptions?kind=DOMAIN" />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/subscriptions"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={
          <ListToolbar
            placeholder="Search name, provider, domain…"
            filters={[
              { type: "select", name: "kind", label: "Type", options: KINDS },
              { type: "select", name: "status", label: "Status", options: [{ value: "ALL", label: "All statuses" }, { value: "PAUSED", label: "Paused" }, { value: "CANCELLED", label: "Cancelled" }, { value: "EXPIRED", label: "Expired" }] },
              { type: "select", name: "due", label: "Renewal", options: [{ value: "30", label: "Next 30 days" }] },
            ]}
          />
        }
        empty={{ icon: <Package />, title: "No subscriptions", description: "Track Google Workspace, Canva, Adobe, AI tools, hosting and domains to never miss a renewal." }}
      />
    </>
  );
}
