// Pure financial aggregation (no DB access) — unit tested in tests/finance.test.ts.
//
// Revenue recognition rules (accrual basis):
//  * Revenue = taxable value (excl. GST) of issued GST/Non-GST invoices and debit notes,
//    minus credit notes, by document date, PLUS income transactions in a REVENUE category
//    that are NOT linked to an invoice payment (e.g. revenue recorded without an invoice).
//  * Payment-linked income transactions are cash receipts of already-recognised revenue,
//    so they are excluded here (no double counting) and appear only in cash-flow figures.
//  * Expenses = expense transactions NOT linked to a vendor bill (net of claimable input GST)
//    PLUS vendor bills by bill date (subtotal, excl. input GST). Bill payments are cash only.
//  * Capital expenditure, tax settlements and owner equity movements never hit the P&L.
import type { CategoryKind, InvoiceType, TxnType } from "@prisma/client";
import { D, Decimal } from "@/lib/money";
import { monthKey } from "@/lib/dates";

type Dec = Decimal;
type DecIn = Decimal.Value | { toString(): string };

export type InvRow = {
  id: string;
  type: InvoiceType;
  issueDate: Date;
  clientId: string;
  projectId: string | null;
  taxableAmount: DecIn;
  items: { serviceId: string | null; taxableAmount: DecIn }[];
};

export type TxnRow = {
  id: string;
  type: TxnType;
  date: Date;
  amount: DecIn;
  taxAmount: DecIn;
  paymentId: string | null;
  vendorBillId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  kind: CategoryKind | null;
  isAcquisition: boolean;
  clientId: string | null;
  projectId: string | null;
  serviceId: string | null;
  vendorId: string | null;
  employeeId: string | null;
};

export type BillRow = {
  id: string;
  billDate: Date;
  subtotal: DecIn;
  categoryId: string;
  categoryName: string;
  kind: CategoryKind;
  isAcquisition: boolean;
  projectId: string | null;
  vendorId: string;
};

export type Bucket = "REVENUE" | "OTHER_INCOME" | "COS" | "OPEX" | "NONOP";

export type Entry = {
  date: Date;
  bucket: Bucket;
  amount: Dec; // signed: credit notes are negative revenue
  categoryId: string | null;
  categoryName: string;
  clientId: string | null;
  projectId: string | null;
  serviceId: string | null;
  isAcquisition: boolean;
  source: "invoice" | "credit_note" | "txn" | "bill";
};

const EXPENSE_BUCKET: Partial<Record<CategoryKind, Bucket>> = {
  COST_OF_SERVICES: "COS",
  OPERATING_EXPENSE: "OPEX",
  NON_OPERATING: "NONOP",
};

export function accrualEntries(invoices: InvRow[], txns: TxnRow[], bills: BillRow[]): Entry[] {
  const out: Entry[] = [];
  for (const inv of invoices) {
    const sign = inv.type === "CREDIT_NOTE" ? -1 : 1;
    if (inv.type !== "CREDIT_NOTE" && !["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"].includes(inv.type)) continue;
    const items = inv.items.length ? inv.items : [{ serviceId: null, taxableAmount: inv.taxableAmount }];
    for (const item of items) {
      out.push({
        date: inv.issueDate,
        bucket: "REVENUE",
        amount: D(item.taxableAmount).times(sign),
        categoryId: null,
        categoryName: inv.type === "CREDIT_NOTE" ? "Credit notes" : "Invoiced revenue",
        clientId: inv.clientId,
        projectId: inv.projectId,
        serviceId: item.serviceId,
        isAcquisition: false,
        source: inv.type === "CREDIT_NOTE" ? "credit_note" : "invoice",
      });
    }
  }
  for (const t of txns) {
    if (t.type === "TRANSFER") continue;
    const net = D(t.amount).minus(D(t.taxAmount));
    if (t.type === "INCOME") {
      if (t.paymentId) continue; // cash receipt of invoiced revenue
      const kind = t.kind ?? "OTHER_INCOME";
      if (kind !== "REVENUE" && kind !== "OTHER_INCOME") continue;
      out.push({
        date: t.date,
        bucket: kind === "REVENUE" ? "REVENUE" : "OTHER_INCOME",
        amount: net,
        categoryId: t.categoryId,
        categoryName: t.categoryName ?? "Uncategorised income",
        clientId: t.clientId,
        projectId: t.projectId,
        serviceId: t.serviceId,
        isAcquisition: false,
        source: "txn",
      });
    } else {
      if (t.vendorBillId) continue; // payment of a bill already expensed
      const bucket = t.kind ? EXPENSE_BUCKET[t.kind] : "OPEX";
      if (!bucket) continue;
      out.push({
        date: t.date,
        bucket,
        amount: net,
        categoryId: t.categoryId,
        categoryName: t.categoryName ?? "Uncategorised expense",
        clientId: t.clientId,
        projectId: t.projectId,
        serviceId: t.serviceId,
        isAcquisition: t.isAcquisition,
        source: "txn",
      });
    }
  }
  for (const b of bills) {
    const bucket = EXPENSE_BUCKET[b.kind];
    if (!bucket) continue;
    out.push({
      date: b.billDate,
      bucket,
      amount: D(b.subtotal),
      categoryId: b.categoryId,
      categoryName: b.categoryName,
      clientId: null,
      projectId: b.projectId,
      serviceId: null,
      isAcquisition: b.isAcquisition,
      source: "bill",
    });
  }
  return out;
}

export type Pnl = {
  grossRevenue: Dec;
  creditNotes: Dec;
  revenue: Dec;
  costOfServices: Dec;
  grossProfit: Dec;
  operatingExpenses: Dec;
  operatingProfit: Dec;
  otherIncome: Dec;
  nonOperating: Dec;
  netProfit: Dec;
  totalExpenses: Dec;
  lines: { bucket: Bucket; categoryName: string; amount: Dec }[];
};

export function summarizePnl(entries: Entry[]): Pnl {
  const z = () => new Decimal(0);
  let grossRevenue = z(), creditNotes = z(), cos = z(), opex = z(), other = z(), nonop = z();
  const lines = new Map<string, { bucket: Bucket; categoryName: string; amount: Dec }>();
  for (const e of entries) {
    if (e.bucket === "REVENUE") {
      if (e.amount.isNegative()) creditNotes = creditNotes.plus(e.amount.abs());
      else grossRevenue = grossRevenue.plus(e.amount);
    } else if (e.bucket === "COS") cos = cos.plus(e.amount);
    else if (e.bucket === "OPEX") opex = opex.plus(e.amount);
    else if (e.bucket === "OTHER_INCOME") other = other.plus(e.amount);
    else nonop = nonop.plus(e.amount);
    const key = `${e.bucket}|${e.categoryName}`;
    const line = lines.get(key) ?? { bucket: e.bucket, categoryName: e.categoryName, amount: z() };
    line.amount = line.amount.plus(e.amount);
    lines.set(key, line);
  }
  const revenue = grossRevenue.minus(creditNotes);
  const grossProfit = revenue.minus(cos);
  const operatingProfit = grossProfit.minus(opex);
  const netProfit = operatingProfit.plus(other).minus(nonop);
  return {
    grossRevenue,
    creditNotes,
    revenue,
    costOfServices: cos,
    grossProfit,
    operatingExpenses: opex,
    operatingProfit,
    otherIncome: other,
    nonOperating: nonop,
    netProfit,
    totalExpenses: cos.plus(opex).plus(nonop),
    lines: [...lines.values()].sort((a, b) => b.amount.comparedTo(a.amount)),
  };
}

export type CashSection = "OPERATING" | "INVESTING" | "FINANCING";
export type CashEntry = { date: Date; amount: Dec; section: CashSection; label: string };

/** Signed cash movements (+in / −out) from transactions; transfers are excluded. */
export function cashEntries(txns: TxnRow[]): CashEntry[] {
  const out: CashEntry[] = [];
  for (const t of txns) {
    if (t.type === "TRANSFER") continue;
    const sign = t.type === "INCOME" ? 1 : -1;
    const amount = D(t.amount).times(sign);
    let section: CashSection = "OPERATING";
    let label: string;
    if (t.kind === "CAPITAL_EXPENDITURE") {
      section = "INVESTING";
      label = t.type === "INCOME" ? "Sale of assets" : "Purchase of equipment & assets";
    } else if (t.kind === "OWNER_EQUITY") {
      section = "FINANCING";
      label = t.type === "INCOME" ? "Capital introduced" : "Owner drawings";
    } else if (t.kind === "TAX_SETTLEMENT") {
      label = t.type === "INCOME" ? "Tax refunds received" : "Taxes paid (GST / TDS)";
    } else if (t.type === "INCOME") {
      label = t.paymentId ? "Receipts from clients (invoices)" : t.kind === "REVENUE" ? "Other receipts from services" : "Other income received";
    } else if (t.vendorBillId) {
      label = "Payments to vendors (bills)";
    } else if (t.employeeId) {
      label = "Payments to employees & freelancers";
    } else {
      label = t.kind === "COST_OF_SERVICES" ? "Direct costs paid" : t.kind === "NON_OPERATING" ? "Finance & other charges" : "Operating expenses paid";
    }
    out.push({ date: t.date, amount, section, label });
  }
  return out;
}

export function groupByMonth<T extends { date: Date }>(rows: T[], months: string[]) {
  const map = new Map<string, T[]>(months.map((m) => [m, []]));
  for (const r of rows) map.get(monthKey(r.date))?.push(r);
  return map;
}

/** Ordinary least squares on y over x = 0..n-1. */
export function linearRegression(ys: number[]) {
  const n = ys.length;
  if (n < 2) return null;
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, predict: (x: number) => intercept + slope * x };
}

/** Normalise a recurring amount to a monthly figure. */
export function monthlyFactor(freq: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY" | "BIENNIAL"): number {
  return { MONTHLY: 1, QUARTERLY: 1 / 3, HALF_YEARLY: 1 / 6, YEARLY: 1 / 12, BIENNIAL: 1 / 24 }[freq];
}

/** Share of the largest client and Herfindahl–Hirschman index (0..1). */
export function concentration(values: number[]) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const shares = values.map((v) => v / total).sort((a, b) => b - a);
  return {
    top1: shares[0] ?? 0,
    top5: shares.slice(0, 5).reduce((a, b) => a + b, 0),
    hhi: shares.reduce((a, s) => a + s * s, 0),
  };
}
