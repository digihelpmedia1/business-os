import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Download, Paperclip, Pencil, Trash2, Wallet } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { parseList, param, withParams, type SearchParams } from "@/lib/list";
import { D, formatMoney } from "@/lib/money";
import { fmtDate, isoDate, todayIST, toDateOnly } from "@/lib/dates";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/options";
import { PageHeader, StatCard, Badge } from "@/components/ui/primitives";
import { LinkButton } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteTransaction, saveTransaction } from "@/server/actions/finance";
import { expenseFields, incomeFields, transferFields, txnFormOptions } from "./fields";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePageAccess("finance");
  const sp = await searchParams;
  const list = parseList(sp, { sortable: ["date", "amount", "createdAt"] as const, defaultSort: "date", pageSize: 25 });
  const f = {
    type: param(sp, "type"), categoryId: param(sp, "categoryId"), accountId: param(sp, "accountId"), clientId: param(sp, "clientId"),
    projectId: param(sp, "projectId"), vendorId: param(sp, "vendorId"), method: param(sp, "method"), from: param(sp, "from"), to: param(sp, "to"),
  };
  let date: Prisma.DateTimeFilter | undefined;
  try {
    if (f.from || f.to) date = { ...(f.from ? { gte: toDateOnly(f.from) } : {}), ...(f.to ? { lte: toDateOnly(f.to) } : {}) };
  } catch {
    date = undefined;
  }
  const where: Prisma.TransactionWhereInput = {
    deletedAt: null,
    ...(f.type ? { type: f.type as "INCOME" } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.accountId ? { OR: [{ accountId: f.accountId }, { toAccountId: f.accountId }] } : {}),
    ...(f.clientId ? { clientId: f.clientId } : {}),
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.vendorId ? { vendorId: f.vendorId } : {}),
    ...(f.method ? { method: f.method as "UPI" } : {}),
    ...(date ? { date } : {}),
    ...(list.q ? { AND: [{ OR: [{ description: { contains: list.q, mode: "insensitive" } }, { reference: { contains: list.q, mode: "insensitive" } }] }] } : {}),
  };
  const [rows, total, sums, o, categories] = await Promise.all([
    db.transaction.findMany({
      where,
      include: { category: true, account: true, toAccount: true, client: { select: { name: true } }, project: { select: { name: true } }, vendor: { select: { name: true } }, employee: { select: { name: true } }, _count: { select: { documents: true } }, documents: { select: { fileId: true }, take: 1 } },
      orderBy: [{ [list.sort]: list.dir }, { createdAt: "desc" }],
      skip: list.skip,
      take: list.pageSize,
    }),
    db.transaction.count({ where }),
    db.transaction.groupBy({ by: ["type"], where, _sum: { amount: true } }),
    txnFormOptions(),
    db.category.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }),
  ]);
  const sum = (t: string) => D(sums.find((s) => s.type === t)?._sum.amount);
  const canEdit = can(user.access, "finance", "EDIT");
  const canFull = can(user.access, "finance", "FULL");
  const today = isoDate(todayIST());
  const defaults = (type: string) => ({ type, date: today, accountId: o.accounts[0]?.value, taxAmount: "0" });

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: "date", header: "Date", sortKey: "date", render: (t) => <span className="whitespace-nowrap">{fmtDate(t.date)}</span> },
    {
      key: "desc", header: "Description",
      render: (t) => (
        <span className="block max-w-[340px]">
          <span className="flex items-center gap-1.5">
            {t.documents[0] ? <a href={`/api/files/${t.documents[0].fileId}`} target="_blank" title="Attachment" className="text-muted hover:text-brand"><Paperclip className="h-3.5 w-3.5" /></a> : null}
            <span className="truncate">{t.description}</span>
          </span>
          <span className="block truncate text-xs text-muted">
            {[t.client?.name, t.project?.name, t.vendor?.name, t.employee?.name, t.reference].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
      ),
    },
    { key: "category", header: "Category", render: (t) => (t.type === "TRANSFER" ? <Badge tone="info">Transfer</Badge> : <span className="text-[13px]">{t.category?.name ?? "—"}{t.paymentId ? <Badge tone="success" className="ml-1">Invoice</Badge> : null}{t.vendorBillId ? <Badge className="ml-1">Bill</Badge> : null}</span>) },
    { key: "account", header: "Account", render: (t) => <span className="text-[13px]">{t.account.name}{t.toAccount ? ` → ${t.toAccount.name}` : ""}<span className="block text-xs text-muted">{PAYMENT_METHOD_OPTIONS.find((m) => m.value === t.method)?.label ?? ""}</span></span> },
    {
      key: "amount", header: "Amount", sortKey: "amount", align: "right",
      render: (t) => (
        <span className={t.type === "INCOME" ? "font-medium text-success" : t.type === "EXPENSE" ? "font-medium text-danger" : "font-medium text-muted"}>
          {t.type === "INCOME" ? "+" : t.type === "EXPENSE" ? "−" : ""}{formatMoney(t.amount)}
          {t.taxAmount.gt(0) ? <span className="block text-xs font-normal text-muted">GST {formatMoney(t.taxAmount)}</span> : null}
        </span>
      ),
    },
    {
      key: "actions", header: "", align: "right",
      render: (t) =>
        t.paymentId ? (
          <span className="text-xs text-muted">Edit via invoice</span>
        ) : (
          <div className="flex justify-end gap-1">
            {canEdit ? (
              <FormDialog
                trigger={<Pencil />}
                triggerVariant="ghost"
                triggerSize="icon-sm"
                title={`Edit ${t.type.toLowerCase()}`}
                fields={(t.type === "INCOME" ? incomeFields(o) : t.type === "EXPENSE" ? expenseFields(o) : transferFields(o)).filter((x) => x.name !== "attachment" || true)}
                defaults={{
                  type: t.type, date: isoDate(t.date), amount: t.amount.toFixed(2), taxAmount: t.taxAmount.toFixed(2), description: t.description, reference: t.reference,
                  method: t.method, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId, clientId: t.clientId, projectId: t.projectId,
                  serviceId: t.serviceId, vendorId: t.vendorId, vendorBillId: t.vendorBillId, employeeId: t.employeeId, payrollMonth: t.payrollMonth, subscriptionId: t.subscriptionId,
                }}
                action={saveTransaction.bind(null, t.id)}
                size="lg"
              />
            ) : null}
            {canFull ? <ConfirmAction action={deleteTransaction.bind(null, t.id)} label={<Trash2 />} variant="ghost" size="icon-sm" title="Delete this transaction?" message="It will be removed from reports. This is recorded in the audit log." confirmLabel="Delete" /> : null}
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every rupee in and out of your bank and cash accounts. Invoice payments appear here automatically."
        actions={
          <>
            <LinkButton href={withParams("/api/export/transactions", sp, { page: null })} variant="outline"><Download /> Export CSV</LinkButton>
            {canEdit ? (
              <>
                <FormDialog trigger={<><ArrowLeftRight /> Transfer</>} triggerVariant="outline" title="Transfer between accounts" fields={transferFields(o)} defaults={defaults("TRANSFER")} action={saveTransaction.bind(null, null)} />
                <FormDialog trigger={<><ArrowDownLeft /> Income</>} triggerVariant="outline" title="Record income" description="For income not tied to an invoice (interest, refunds, direct service income)." fields={incomeFields(o)} defaults={defaults("INCOME")} action={saveTransaction.bind(null, null)} size="lg" />
                <FormDialog trigger={<><ArrowUpRight /> Expense</>} title="Record expense" fields={expenseFields(o)} defaults={defaults("EXPENSE")} action={saveTransaction.bind(null, null)} size="lg" />
              </>
            ) : null}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Money in" value={formatMoney(sum("INCOME"))} tone="success" hint="Matching filters" />
        <StatCard label="Money out" value={formatMoney(sum("EXPENSE"))} tone="danger" />
        <StatCard label="Net" value={formatMoney(sum("INCOME").minus(sum("EXPENSE")))} />
        <StatCard label="Transactions" value={total} hint={<Link href="/finance/accounts" className="text-brand">View account balances</Link>} />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        basePath="/finance/transactions"
        searchParams={sp}
        sort={list.sort}
        dir={list.dir}
        total={total}
        page={list.page}
        pageSize={list.pageSize}
        toolbar={
          <ListToolbar
            placeholder="Search description or reference…"
            filters={[
              { type: "select", name: "type", label: "Type", options: [{ value: "INCOME", label: "Income" }, { value: "EXPENSE", label: "Expense" }, { value: "TRANSFER", label: "Transfer" }] },
              { type: "select", name: "categoryId", label: "Category", options: categories.map((c) => ({ value: c.id, label: `${c.type === "INCOME" ? "In" : "Out"} · ${c.name}` })) },
              { type: "select", name: "accountId", label: "Account", options: o.accounts },
              { type: "select", name: "clientId", label: "Client", options: o.clients },
              { type: "select", name: "projectId", label: "Project", options: o.projects },
              { type: "select", name: "method", label: "Method", options: PAYMENT_METHOD_OPTIONS },
              { type: "date", name: "from", label: "From" },
              { type: "date", name: "to", label: "To" },
            ]}
          />
        }
        empty={{ icon: <Wallet />, title: "No transactions found", description: o.accounts.length ? "Record income, expenses and transfers, or record payments on invoices." : "Add a bank or cash account first (Finance → Bank & Cash Accounts)." }}
      />
    </>
  );
}
