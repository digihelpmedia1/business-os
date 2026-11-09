import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can, type ModuleKey } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { isoDate, resolveRange, todayIST, toDateOnly } from "@/lib/dates";
import { getBalanceSheet, getCashFlow, getMonthlySeries, getPayables, getPnl, getReceivables, projectProfitability } from "@/lib/finance/reports";
import { clientProfitability, computeMetrics, serviceProfitability } from "@/lib/finance/metrics";
import { invoiceOutstanding, effectiveInvoiceStatus } from "@/lib/finance/ledger";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

type Cell = string | number | null | undefined | { toString(): string };

function csv(rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return "";
    let s = typeof v === "number" ? String(v) : v.toString();
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; // CSV/formula injection guard
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

const MODULE_FOR: Record<string, ModuleKey> = {
  pnl: "finance", cashflow: "finance", balance: "finance", receivables: "finance", payables: "finance", monthly: "finance",
  transactions: "finance", invoices: "billing", payments: "billing", clients: "billing", quotes: "billing",
  vendors: "vendors", bills: "vendors", projects: "projects", time: "projects", employees: "team", subscriptions: "assets", assets: "assets",
  metrics: "intelligence", "client-profitability": "intelligence", "service-profitability": "intelligence", "project-profitability": "intelligence",
};

export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { report } = await params;
  const module = MODULE_FOR[report];
  if (!module) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  if (!can(user.access, module) && !(module === "intelligence" && can(user.access, "reports"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const settings = await getSettings();
  const range = resolveRange(q("range") ?? (report === "monthly" ? "this_fy" : "this_month"), { from: q("from"), to: q("to") }, settings.fyStartMonth);
  let asOf = todayIST();
  try {
    if (q("asOf")) asOf = toDateOnly(q("asOf")!);
  } catch {
    /* default */
  }
  let rows: Cell[][] = [];

  switch (report) {
    case "pnl": {
      const p = await getPnl(range);
      rows = [["Profit & Loss", `${isoDate(range.from)} to ${isoDate(range.to)}`], [], ["Section", "Line", "Amount (INR)"]];
      for (const l of p.lines) rows.push([l.bucket, l.categoryName, l.amount.toFixed(2)]);
      rows.push([], ["", "Net revenue", p.revenue.toFixed(2)], ["", "Cost of services", p.costOfServices.toFixed(2)], ["", "Gross profit", p.grossProfit.toFixed(2)],
        ["", "Operating expenses", p.operatingExpenses.toFixed(2)], ["", "Operating profit", p.operatingProfit.toFixed(2)], ["", "Other income", p.otherIncome.toFixed(2)],
        ["", "Non-operating expenses", p.nonOperating.toFixed(2)], ["", "Net profit", p.netProfit.toFixed(2)], ["", "Cash received from clients", p.clientReceipts.toFixed(2)]);
      break;
    }
    case "cashflow": {
      const c = await getCashFlow(range);
      rows = [["Cash Flow", `${isoDate(range.from)} to ${isoDate(range.to)}`], [], ["Section", "Line", "Amount (INR)"], ["", "Opening cash", c.opening.toFixed(2)]];
      for (const [name, s] of [["Operating", c.operating], ["Investing", c.investing], ["Financing", c.financing]] as const) {
        for (const l of s.lines) rows.push([name, l.label, l.amount.toFixed(2)]);
        rows.push([name, "Net", s.total.toFixed(2)]);
      }
      rows.push(["", "Net change", c.netChange.toFixed(2)], ["", "Closing cash", c.closing.toFixed(2)]);
      break;
    }
    case "balance": {
      const b = await getBalanceSheet(asOf);
      rows = [["Balance Sheet (management)", `as of ${isoDate(asOf)}`], [], ["Section", "Line", "Amount (INR)"]];
      b.assetLines.forEach((l) => rows.push(["Assets", l.label, l.amount.toFixed(2)]));
      rows.push(["Assets", "Total", b.totalAssets.toFixed(2)]);
      b.liabilityLines.forEach((l) => rows.push(["Liabilities", l.label, l.amount.toFixed(2)]));
      rows.push(["Liabilities", "Total", b.totalLiabilities.toFixed(2)]);
      b.equityLines.forEach((l) => rows.push(["Equity", l.label, l.amount.toFixed(2)]));
      rows.push(["Equity", "Total", b.totalEquity.toFixed(2)]);
      break;
    }
    case "receivables": {
      const r = await getReceivables(asOf);
      rows = [["Invoice", "Client", "Invoice date", "Due date", "Days overdue", "Ageing", "Total", "Outstanding"]];
      r.rows.forEach((x) => rows.push([x.number, x.client.name, isoDate(x.issueDate), isoDate(x.dueDate), x.daysOverdue, x.bucket, x.total.toFixed(2), x.outstanding.toFixed(2)]));
      break;
    }
    case "payables": {
      const r = await getPayables(asOf);
      rows = [["Bill", "Vendor", "Bill date", "Due date", "Days overdue", "Ageing", "Total", "Outstanding"]];
      r.rows.forEach((x) => rows.push([x.billNumber, x.vendor.name, isoDate(x.billDate), isoDate(x.dueDate), x.daysOverdue, x.bucket, x.total.toFixed(2), x.outstanding.toFixed(2)]));
      break;
    }
    case "monthly": {
      const s = await getMonthlySeries(range);
      rows = [["Month", "Revenue", "Expenses", "Net profit", "Cash in", "Cash out", "Net cash"]];
      s.forEach((x) => rows.push([x.month, x.revenue.toFixed(2), x.expenses.toFixed(2), x.profit.toFixed(2), x.cashIn.toFixed(2), x.cashOut.toFixed(2), x.netCash.toFixed(2)]));
      break;
    }
    case "transactions": {
      const where: Prisma.TransactionWhereInput = { deletedAt: null };
      if (q("type")) where.type = q("type") as "INCOME";
      if (q("categoryId")) where.categoryId = q("categoryId");
      if (q("accountId")) where.accountId = q("accountId");
      if (q("clientId")) where.clientId = q("clientId");
      if (q("projectId")) where.projectId = q("projectId");
      try {
        if (q("from") || q("to")) where.date = { ...(q("from") ? { gte: toDateOnly(q("from")!) } : {}), ...(q("to") ? { lte: toDateOnly(q("to")!) } : {}) };
      } catch {
        /* ignore */
      }
      const t = await db.transaction.findMany({ where, include: { category: true, account: true, toAccount: true, client: true, project: true, vendor: true, employee: true }, orderBy: { date: "asc" } });
      rows = [["Date", "Type", "Description", "Category", "Treatment", "Account", "To account", "Amount", "Input GST", "Method", "Reference", "Client", "Project", "Vendor", "Employee"]];
      t.forEach((x) => rows.push([isoDate(x.date), x.type, x.description, x.category?.name, x.category?.kind, x.account.name, x.toAccount?.name, x.amount.toFixed(2), x.taxAmount.toFixed(2), x.method, x.reference, x.client?.name, x.project?.name, x.vendor?.name, x.employee?.name]));
      break;
    }
    case "invoices": {
      const inv = await db.invoice.findMany({ where: { deletedAt: null, ...(q("from") || q("to") ? { issueDate: { gte: range.from, lte: range.to } } : {}) }, orderBy: { issueDate: "asc" } });
      rows = [["Number", "Type", "Status", "Client", "Client GSTIN", "Place of supply", "Invoice date", "Due date", "Taxable", "CGST", "SGST", "IGST", "Total", "Paid (incl. TDS)", "Credited", "Outstanding"]];
      inv.forEach((x) => rows.push([x.number ?? "DRAFT", x.type, effectiveInvoiceStatus(x), x.clientName, x.clientGstin, x.placeOfSupply, isoDate(x.issueDate), isoDate(x.dueDate), x.taxableAmount.toFixed(2), x.cgstAmount.toFixed(2), x.sgstAmount.toFixed(2), x.igstAmount.toFixed(2), x.total.toFixed(2), x.amountPaid.toFixed(2), x.amountCredited.toFixed(2), x.type === "CREDIT_NOTE" ? "" : invoiceOutstanding(x).toFixed(2)]));
      break;
    }
    case "payments": {
      const p = await db.payment.findMany({ include: { invoice: true, client: true, account: true }, orderBy: { paymentDate: "asc" } });
      rows = [["Receipt", "Date", "Client", "Invoice", "Amount", "TDS", "Method", "Account", "Reference", "Voided"]];
      p.forEach((x) => rows.push([x.receiptNumber, isoDate(x.paymentDate), x.client.name, x.invoice.number, x.amount.toFixed(2), x.tdsAmount.toFixed(2), x.method, x.account.name, x.reference, x.voidedAt ? "yes" : ""]));
      break;
    }
    case "clients": {
      const c = await db.client.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
      rows = [["Name", "Business name", "Email", "Phone", "GSTIN", "PAN", "City", "State", "Status", "Client since", "CRM ID"]];
      c.forEach((x) => rows.push([x.name, x.businessName, x.email, x.phone, x.gstin, x.pan, x.city, x.state, x.status, isoDate(x.acquiredAt), x.externalCrmId]));
      break;
    }
    case "quotes": {
      const qs = await db.quote.findMany({ where: { deletedAt: null }, include: { client: true }, orderBy: { issueDate: "asc" } });
      rows = [["Number", "Type", "Title", "Client", "Date", "Valid until", "Status", "Version", "Total"]];
      qs.forEach((x) => rows.push([x.number, x.kind, x.title, x.client.name, isoDate(x.issueDate), isoDate(x.expiryDate), x.status, x.version, x.total.toFixed(2)]));
      break;
    }
    case "vendors": {
      const v = await db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
      rows = [["Name", "Category", "Contact", "Email", "Phone", "GSTIN", "PAN", "Payment terms (days)"]];
      v.forEach((x) => rows.push([x.name, x.category, x.contactPerson, x.email, x.phone, x.gstin, x.pan, x.paymentTermsDays]));
      break;
    }
    case "bills": {
      const b = await db.vendorBill.findMany({ where: { deletedAt: null }, include: { vendor: true, category: true }, orderBy: { billDate: "asc" } });
      rows = [["Vendor", "Bill number", "Bill date", "Due date", "Category", "Subtotal", "Input GST", "Total", "Paid", "Status"]];
      b.forEach((x) => rows.push([x.vendor.name, x.billNumber, isoDate(x.billDate), isoDate(x.dueDate), x.category.name, x.subtotal.toFixed(2), x.taxAmount.toFixed(2), x.total.toFixed(2), x.amountPaid.toFixed(2), x.status]));
      break;
    }
    case "projects":
    case "project-profitability": {
      const p = await projectProfitability(report === "projects" ? undefined : range);
      rows = [["Project", "Client", "Status", "Billing", "Budget", "Revenue", "Direct expenses", "Time cost", "Hours", "Profit", "Margin %"]];
      p.forEach((x) => rows.push([x.name, x.client?.name, x.status, x.billingType, x.budget?.toFixed(2), x.revenue.toFixed(2), x.directExpenses.toFixed(2), x.timeCost.toFixed(2), x.hours.toFixed(2), x.profit.toFixed(2), x.margin === null ? "" : (x.margin * 100).toFixed(1)]));
      break;
    }
    case "time": {
      const t = await db.timeEntry.findMany({ where: { date: { gte: range.from, lte: range.to } }, include: { employee: true, project: true, task: true }, orderBy: { date: "asc" } });
      rows = [["Date", "Employee", "Project", "Task", "Hours", "Billable", "Cost rate", "Cost", "Description"]];
      t.forEach((x) => rows.push([isoDate(x.date), x.employee.name, x.project.name, x.task?.title, x.hours.toFixed(2), x.billable ? "yes" : "no", x.costRate.toFixed(2), x.hours.times(x.costRate).toFixed(2), x.description]));
      break;
    }
    case "employees": {
      const e = await db.employee.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
      rows = [["Name", "Type", "Designation", "Department", "Email", "Phone", "Joining date", "Status", "Compensation", "Monthly salary", "Hourly rate", "Cost per hour"]];
      e.forEach((x) => rows.push([x.name, x.type, x.designation, x.department, x.email, x.phone, isoDate(x.joiningDate), x.status, x.compensationType, x.monthlySalary?.toFixed(2), x.hourlyRate?.toFixed(2), x.costPerHour?.toFixed(2)]));
      break;
    }
    case "subscriptions": {
      const s = await db.subscription.findMany({ where: { deletedAt: null }, orderBy: { renewalDate: "asc" } });
      rows = [["Name", "Provider", "Type", "Plan", "Cycle", "Cost (INR)", "Renewal date", "Auto-renew", "Status", "Domain"]];
      s.forEach((x) => rows.push([x.name, x.provider, x.kind, x.planName, x.billingCycle, x.cost.toFixed(2), isoDate(x.renewalDate), x.autoRenew ? "yes" : "no", x.status, x.domainName]));
      break;
    }
    case "assets": {
      const a = await db.asset.findMany({ where: { deletedAt: null }, include: { assignedEmployee: true }, orderBy: { name: "asc" } });
      rows = [["Name", "Category", "Brand", "Model", "Serial", "Purchase date", "Value", "Warranty until", "Status", "Assigned to"]];
      a.forEach((x) => rows.push([x.name, x.category, x.brand, x.model, x.serialNumber, isoDate(x.purchaseDate), x.purchaseValue.toFixed(2), isoDate(x.warrantyUntil), x.status, x.assignedEmployee?.name]));
      break;
    }
    case "metrics": {
      const { metrics } = await computeMetrics(range);
      rows = [["Metric", "Group", "Value", "Previous period", "Formula", "Note"]];
      metrics.forEach((x) => rows.push([x.label, x.group, x.value === null ? (x.infinite ? "Not burning cash" : "Insufficient Data") : x.value.toFixed(4), x.previous?.toFixed(4), x.formula, x.reason]));
      break;
    }
    case "client-profitability": {
      const c = await clientProfitability(range);
      rows = [["Client", "Revenue", "Attributed cost", "Profit", "Margin %"]];
      c.forEach((x) => rows.push([x.name, x.revenue.toFixed(2), x.cost.toFixed(2), x.profit.toFixed(2), x.margin === null ? "" : (x.margin * 100).toFixed(1)]));
      break;
    }
    case "service-profitability": {
      const s = await serviceProfitability(range);
      rows = [["Service", "Revenue", "Attributed cost", "Profit", "Margin %"]];
      s.forEach((x) => rows.push([x.name, x.revenue.toFixed(2), x.cost.toFixed(2), x.profit.toFixed(2), x.margin === null ? "" : (x.margin * 100).toFixed(1)]));
      break;
    }
  }
  await audit({ userId: user.id, action: "EXPORT", entityType: "Report", entityId: report, summary: `Exported ${report} CSV` });
  return new NextResponse(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dhm-${report}-${isoDate(todayIST())}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
