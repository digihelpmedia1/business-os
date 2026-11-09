import "server-only";
import { db } from "@/lib/db";
import { D, Decimal, num } from "@/lib/money";
import { addDays, daysBetween, monthLabel, monthsInRange, todayIST } from "@/lib/dates";
import {
  accrualEntries,
  cashEntries,
  groupByMonth,
  summarizePnl,
  type BillRow,
  type CashSection,
  type Entry,
  type InvRow,
  type TxnRow,
} from "./engine";
import { LIVE_STATUSES, RECEIVABLE_TYPES } from "./constants";
import { accountBalances } from "./ledger";

export type Range = { from: Date; to: Date };

async function loadInvoices({ from, to }: Range): Promise<InvRow[]> {
  const rows = await db.invoice.findMany({
    where: {
      deletedAt: null,
      status: { in: LIVE_STATUSES },
      type: { in: ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE", "CREDIT_NOTE"] },
      issueDate: { gte: from, lte: to },
    },
    select: {
      id: true, type: true, issueDate: true, clientId: true, projectId: true, taxableAmount: true,
      items: { select: { serviceId: true, taxableAmount: true } },
    },
  });
  return rows;
}

export async function loadTxns({ from, to }: Range): Promise<TxnRow[]> {
  const rows = await db.transaction.findMany({
    where: { deletedAt: null, date: { gte: from, lte: to } },
    select: {
      id: true, type: true, date: true, amount: true, taxAmount: true, paymentId: true, vendorBillId: true,
      categoryId: true, clientId: true, projectId: true, serviceId: true, vendorId: true, employeeId: true,
      category: { select: { name: true, kind: true, isAcquisition: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    categoryName: r.category?.name ?? null,
    kind: r.category?.kind ?? null,
    isAcquisition: r.category?.isAcquisition ?? false,
  }));
}

async function loadBills({ from, to }: Range): Promise<BillRow[]> {
  const rows = await db.vendorBill.findMany({
    where: { deletedAt: null, status: { not: "CANCELLED" }, billDate: { gte: from, lte: to } },
    select: {
      id: true, billDate: true, subtotal: true, categoryId: true, projectId: true, vendorId: true,
      category: { select: { name: true, kind: true, isAcquisition: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    categoryName: r.category.name,
    kind: r.category.kind,
    isAcquisition: r.category.isAcquisition,
  }));
}

export async function loadPeriod(range: Range) {
  const [invoices, txns, bills] = await Promise.all([loadInvoices(range), loadTxns(range), loadBills(range)]);
  const entries = accrualEntries(invoices, txns, bills);
  return { invoices, txns, bills, entries, cash: cashEntries(txns) };
}

export async function getPnl(range: Range) {
  const { entries, cash } = await loadPeriod(range);
  const pnl = summarizePnl(entries);
  const cashIn = cash.filter((c) => c.amount.gt(0)).reduce((a, c) => a.plus(c.amount), new Decimal(0));
  const cashOut = cash.filter((c) => c.amount.lt(0)).reduce((a, c) => a.plus(c.amount.abs()), new Decimal(0));
  const clientReceipts = cash
    .filter((c) => c.label === "Receipts from clients (invoices)" || c.label === "Other receipts from services")
    .reduce((a, c) => a.plus(c.amount), new Decimal(0));
  return { ...pnl, cashIn, cashOut, netCashFlow: cashIn.minus(cashOut), clientReceipts };
}

export type MonthPoint = {
  month: string;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
  cashIn: number;
  cashOut: number;
  netCash: number;
};

export async function getMonthlySeries(range: Range): Promise<MonthPoint[]> {
  const months = monthsInRange(range.from, range.to);
  const { entries, cash } = await loadPeriod(range);
  const em = groupByMonth(entries, months);
  const cm = groupByMonth(cash, months);
  return months.map((m) => {
    const pnl = summarizePnl(em.get(m) ?? []);
    const c = cm.get(m) ?? [];
    const cashIn = c.filter((x) => x.amount.gt(0)).reduce((a, x) => a + num(x.amount), 0);
    const cashOut = c.filter((x) => x.amount.lt(0)).reduce((a, x) => a + Math.abs(num(x.amount)), 0);
    return {
      month: m,
      label: monthLabel(m),
      revenue: num(pnl.revenue),
      expenses: num(pnl.totalExpenses),
      profit: num(pnl.netProfit),
      cashIn,
      cashOut,
      netCash: cashIn - cashOut,
    };
  });
}

export function sumBy<K extends string>(entries: Entry[], key: (e: Entry) => K | null, filter: (e: Entry) => boolean) {
  const map = new Map<K, Decimal>();
  for (const e of entries) {
    if (!filter(e)) continue;
    const k = key(e);
    if (k === null) continue;
    map.set(k, (map.get(k) ?? new Decimal(0)).plus(e.amount));
  }
  return map;
}

export async function revenueByService(range: Range) {
  const { entries } = await loadPeriod(range);
  const map = sumBy(entries, (e) => e.serviceId ?? "__none", (e) => e.bucket === "REVENUE");
  const services = await db.service.findMany({ select: { id: true, name: true } });
  return [...map.entries()]
    .map(([id, amount]) => ({ id, name: services.find((s) => s.id === id)?.name ?? "Unassigned service", amount: num(amount) }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

export async function expenseByCategory(range: Range) {
  const { entries } = await loadPeriod(range);
  const map = sumBy(entries, (e) => e.categoryName, (e) => e.bucket === "COS" || e.bucket === "OPEX" || e.bucket === "NONOP");
  return [...map.entries()].map(([name, amount]) => ({ name, amount: num(amount) })).sort((a, b) => b.amount - a.amount);
}

export async function getCashFlow(range: Range) {
  const txns = await loadTxns(range);
  const entries = cashEntries(txns);
  const sections: Record<CashSection, Map<string, Decimal>> = {
    OPERATING: new Map(),
    INVESTING: new Map(),
    FINANCING: new Map(),
  };
  for (const e of entries) {
    const m = sections[e.section];
    m.set(e.label, (m.get(e.label) ?? new Decimal(0)).plus(e.amount));
  }
  const accounts = await db.account.findMany();
  const openingIntroduced = accounts
    .filter((a) => a.openingDate >= range.from && a.openingDate <= range.to)
    .reduce((a, acc) => a.plus(D(acc.openingBalance)), new Decimal(0));
  const openingBalances = await accountBalances(addDays(range.from, -1));
  const opening = openingBalances.reduce((a, b) => a.plus(b.balance), new Decimal(0));
  const closingBalances = await accountBalances(range.to);
  const closing = closingBalances.reduce((a, b) => a.plus(b.balance), new Decimal(0));
  const toList = (m: Map<string, Decimal>) =>
    [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount.comparedTo(a.amount));
  const total = (m: Map<string, Decimal>) => [...m.values()].reduce((a, b) => a.plus(b), new Decimal(0));
  return {
    operating: { lines: toList(sections.OPERATING), total: total(sections.OPERATING) },
    investing: { lines: toList(sections.INVESTING), total: total(sections.INVESTING) },
    financing: { lines: toList(sections.FINANCING), total: total(sections.FINANCING) },
    netChange: total(sections.OPERATING).plus(total(sections.INVESTING)).plus(total(sections.FINANCING)),
    opening,
    openingIntroduced,
    closing,
  };
}

/** Receivables outstanding as of a date, with ageing by days past due. */
export async function getReceivables(asOf: Date = todayIST()) {
  const invoices = await db.invoice.findMany({
    where: {
      deletedAt: null,
      type: { in: RECEIVABLE_TYPES },
      status: { in: LIVE_STATUSES },
      issueDate: { lte: asOf },
    },
    include: {
      client: { select: { id: true, name: true } },
      payments: { where: { voidedAt: null, paymentDate: { lte: asOf } }, select: { amount: true, tdsAmount: true } },
      adjustments: {
        where: { type: "CREDIT_NOTE", status: { in: LIVE_STATUSES }, issueDate: { lte: asOf } },
        select: { total: true },
      },
    },
    orderBy: { dueDate: "asc" },
  });
  const rows = invoices
    .map((inv) => {
      const paid = inv.payments.reduce((a, p) => a.plus(D(p.amount)).plus(D(p.tdsAmount)), new Decimal(0));
      const credited = inv.adjustments.reduce((a, c) => a.plus(D(c.total)), new Decimal(0));
      const outstanding = Decimal.max(D(inv.total).minus(paid).minus(credited), 0);
      const daysOverdue = inv.dueDate ? daysBetween(inv.dueDate, asOf) : 0;
      const bucket =
        daysOverdue <= 0 ? "Not due" : daysOverdue <= 30 ? "1–30 days" : daysOverdue <= 60 ? "31–60 days" : daysOverdue <= 90 ? "61–90 days" : "90+ days";
      return { id: inv.id, number: inv.number, client: inv.client, issueDate: inv.issueDate, dueDate: inv.dueDate, total: D(inv.total), outstanding, daysOverdue, bucket };
    })
    .filter((r) => r.outstanding.gt(0));
  const total = rows.reduce((a, r) => a.plus(r.outstanding), new Decimal(0));
  return { rows, total, buckets: ageBuckets(rows) };
}

export async function getPayables(asOf: Date = todayIST()) {
  const bills = await db.vendorBill.findMany({
    where: { deletedAt: null, status: { not: "CANCELLED" }, billDate: { lte: asOf } },
    include: {
      vendor: { select: { id: true, name: true } },
      payments: { where: { deletedAt: null, date: { lte: asOf } }, select: { amount: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  const rows = bills
    .map((b) => {
      const paid = b.payments.reduce((a, p) => a.plus(D(p.amount)), new Decimal(0));
      const outstanding = Decimal.max(D(b.total).minus(paid), 0);
      const daysOverdue = b.dueDate ? daysBetween(b.dueDate, asOf) : 0;
      const bucket =
        daysOverdue <= 0 ? "Not due" : daysOverdue <= 30 ? "1–30 days" : daysOverdue <= 60 ? "31–60 days" : daysOverdue <= 90 ? "61–90 days" : "90+ days";
      return { id: b.id, billNumber: b.billNumber, vendor: b.vendor, billDate: b.billDate, dueDate: b.dueDate, total: D(b.total), outstanding, daysOverdue, bucket };
    })
    .filter((r) => r.outstanding.gt(0));
  const total = rows.reduce((a, r) => a.plus(r.outstanding), new Decimal(0));
  return { rows, total, buckets: ageBuckets(rows) };
}

function ageBuckets(rows: { bucket: string; outstanding: Decimal }[]) {
  const order = ["Not due", "1–30 days", "31–60 days", "61–90 days", "90+ days"];
  return order.map((b) => ({
    bucket: b,
    amount: rows.filter((r) => r.bucket === b).reduce((a, r) => a.plus(r.outstanding), new Decimal(0)),
  }));
}

/**
 * Simplified management balance sheet (not a statutory one). Fixed assets are at
 * cost (no depreciation); retained earnings is the balancing figure.
 */
export async function getBalanceSheet(asOf: Date = todayIST()) {
  const EPOCH = new Date(Date.UTC(1970, 0, 1));
  const [balances, receivables, payables, tds, inputTxn, inputBills, output, creditTax, taxPaid, equityTxns, assets, advances] =
    await Promise.all([
      accountBalances(asOf),
      getReceivables(asOf),
      getPayables(asOf),
      db.payment.aggregate({ where: { voidedAt: null, paymentDate: { lte: asOf } }, _sum: { tdsAmount: true } }),
      db.transaction.aggregate({
        where: { deletedAt: null, type: "EXPENSE", vendorBillId: null, date: { lte: asOf } },
        _sum: { taxAmount: true },
      }),
      db.vendorBill.aggregate({
        where: { deletedAt: null, status: { not: "CANCELLED" }, billDate: { lte: asOf } },
        _sum: { taxAmount: true },
      }),
      db.invoice.aggregate({
        where: { deletedAt: null, type: { in: ["TAX_INVOICE", "DEBIT_NOTE"] }, status: { in: LIVE_STATUSES }, issueDate: { lte: asOf } },
        _sum: { taxTotal: true },
      }),
      db.invoice.aggregate({
        where: { deletedAt: null, type: "CREDIT_NOTE", status: { in: LIVE_STATUSES }, issueDate: { lte: asOf } },
        _sum: { taxTotal: true },
      }),
      db.transaction.findMany({
        where: { deletedAt: null, date: { lte: asOf }, category: { kind: "TAX_SETTLEMENT" } },
        select: { type: true, amount: true },
      }),
      db.transaction.findMany({
        where: { deletedAt: null, date: { lte: asOf }, category: { kind: "OWNER_EQUITY" } },
        select: { type: true, amount: true },
      }),
      db.asset.aggregate({
        where: { deletedAt: null, status: { notIn: ["SOLD", "LOST", "RETIRED"] }, purchaseDate: { gte: EPOCH, lte: asOf } },
        _sum: { purchaseValue: true },
      }),
      db.payment.aggregate({
        where: { voidedAt: null, paymentDate: { lte: asOf }, invoice: { type: { in: ["PROFORMA", "ADVANCE"] } } },
        _sum: { amount: true, tdsAmount: true },
      }),
    ]);

  const cash = balances.reduce((a, b) => a.plus(b.balance), new Decimal(0));
  const inputGst = D(inputTxn._sum.taxAmount).plus(D(inputBills._sum.taxAmount));
  const outputGst = D(output._sum.taxTotal).minus(D(creditTax._sum.taxTotal));
  const taxSettled = taxPaid.reduce((a, t) => (t.type === "EXPENSE" ? a.plus(D(t.amount)) : a.minus(D(t.amount))), new Decimal(0));
  const fixedAssets = D(assets._sum.purchaseValue);
  const tdsReceivable = D(tds._sum.tdsAmount);
  const customerAdvances = D(advances._sum.amount).plus(D(advances._sum.tdsAmount));

  const assetLines = [
    ...balances.map((b) => ({ label: `Cash & bank — ${b.name}`, amount: b.balance })),
    { label: "Accounts receivable", amount: receivables.total },
    { label: "TDS receivable (deducted by clients)", amount: tdsReceivable },
    { label: "Input GST credit", amount: inputGst },
    { label: "Fixed assets (at cost)", amount: fixedAssets },
  ];
  const liabilityLines = [
    { label: "Accounts payable", amount: payables.total },
    { label: "Output GST (net of tax paid)", amount: outputGst.minus(taxSettled) },
    { label: "Customer advances (proforma / advance invoices)", amount: customerAdvances },
  ];
  const totalAssets = assetLines.reduce((a, l) => a.plus(l.amount), new Decimal(0));
  const totalLiabilities = liabilityLines.reduce((a, l) => a.plus(l.amount), new Decimal(0));
  const openingCapital = balances.reduce((a, b) => (b.openingDate <= asOf ? a.plus(D(b.openingBalance)) : a), new Decimal(0));
  const ownerNet = equityTxns.reduce((a, t) => (t.type === "INCOME" ? a.plus(D(t.amount)) : a.minus(D(t.amount))), new Decimal(0));
  const retained = totalAssets.minus(totalLiabilities).minus(openingCapital).minus(ownerNet);
  const equityLines = [
    { label: "Opening balances (capital)", amount: openingCapital },
    { label: "Capital introduced less drawings", amount: ownerNet },
    { label: "Retained earnings (balancing figure)", amount: retained },
  ];
  return {
    asOf,
    cash,
    assetLines,
    liabilityLines,
    equityLines,
    totalAssets,
    totalLiabilities,
    totalEquity: totalAssets.minus(totalLiabilities),
  };
}

/** All-time (or ranged) profitability per project. */
export async function projectProfitability(range?: Range, projectIds?: string[]) {
  const dateFilter = range ? { gte: range.from, lte: range.to } : undefined;
  const whereProject = projectIds ? { in: projectIds } : { not: null };
  const [invoices, txns, bills, time, projects] = await Promise.all([
    db.invoice.findMany({
      where: {
        deletedAt: null,
        projectId: whereProject,
        status: { in: LIVE_STATUSES },
        type: { in: ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE", "CREDIT_NOTE"] },
        ...(dateFilter ? { issueDate: dateFilter } : {}),
      },
      select: { projectId: true, type: true, taxableAmount: true },
    }),
    db.transaction.findMany({
      where: { deletedAt: null, projectId: whereProject, vendorBillId: null, type: { in: ["EXPENSE", "INCOME"] }, paymentId: null, ...(dateFilter ? { date: dateFilter } : {}) },
      select: { projectId: true, type: true, amount: true, taxAmount: true, category: { select: { kind: true } } },
    }),
    db.vendorBill.findMany({
      where: { deletedAt: null, status: { not: "CANCELLED" }, projectId: whereProject, ...(dateFilter ? { billDate: dateFilter } : {}) },
      select: { projectId: true, subtotal: true },
    }),
    db.timeEntry.findMany({
      where: { projectId: projectIds ? { in: projectIds } : undefined, ...(dateFilter ? { date: dateFilter } : {}) },
      select: { projectId: true, hours: true, costRate: true },
    }),
    db.project.findMany({
      where: { deletedAt: null, ...(projectIds ? { id: { in: projectIds } } : {}) },
      select: { id: true, name: true, status: true, budget: true, billingType: true, serviceId: true, client: { select: { id: true, name: true } } },
    }),
  ]);
  return projects
    .map((p) => {
      const revenue = invoices
        .filter((i) => i.projectId === p.id)
        .reduce((a, i) => (i.type === "CREDIT_NOTE" ? a.minus(D(i.taxableAmount)) : a.plus(D(i.taxableAmount))), new Decimal(0))
        .plus(
          txns
            .filter((t) => t.projectId === p.id && t.type === "INCOME" && t.category?.kind === "REVENUE")
            .reduce((a, t) => a.plus(D(t.amount).minus(D(t.taxAmount))), new Decimal(0)),
        );
      const directExpenses = txns
        .filter((t) => t.projectId === p.id && t.type === "EXPENSE" && ["COST_OF_SERVICES", "OPERATING_EXPENSE", "NON_OPERATING"].includes(t.category?.kind ?? "OPERATING_EXPENSE"))
        .reduce((a, t) => a.plus(D(t.amount).minus(D(t.taxAmount))), new Decimal(0))
        .plus(bills.filter((b) => b.projectId === p.id).reduce((a, b) => a.plus(D(b.subtotal)), new Decimal(0)));
      const pt = time.filter((t) => t.projectId === p.id);
      const hours = pt.reduce((a, t) => a.plus(D(t.hours)), new Decimal(0));
      const timeCost = pt.reduce((a, t) => a.plus(D(t.hours).times(D(t.costRate))), new Decimal(0));
      const totalCost = directExpenses.plus(timeCost);
      const profit = revenue.minus(totalCost);
      return {
        ...p,
        revenue,
        directExpenses,
        timeCost,
        hours,
        totalCost,
        profit,
        margin: revenue.gt(0) ? profit.dividedBy(revenue).toNumber() : null,
        budgetUsed: p.budget && D(p.budget).gt(0) ? totalCost.dividedBy(D(p.budget)).toNumber() : null,
      };
    })
    .sort((a, b) => b.revenue.comparedTo(a.revenue));
}
