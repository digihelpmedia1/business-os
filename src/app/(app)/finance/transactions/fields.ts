import "server-only";
import type { FieldDef } from "@/components/ui/form-dialog";
import { accountOptions, categoryOptions, clientOptions, employeeOptions, PAYMENT_METHOD_OPTIONS, projectOptions, serviceOptions, vendorOptions, type Option } from "@/lib/options";
import { db } from "@/lib/db";

export async function txnFormOptions() {
  const [accounts, income, expense, clients, projects, vendors, employees, services, bills, subs] = await Promise.all([
    accountOptions(),
    categoryOptions("INCOME"),
    categoryOptions("EXPENSE"),
    clientOptions(),
    projectOptions(),
    vendorOptions(),
    employeeOptions(),
    serviceOptions(),
    db.vendorBill.findMany({ where: { deletedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, include: { vendor: { select: { name: true } } }, orderBy: { dueDate: "asc" } }),
    db.subscription.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    accounts,
    income: income.filter((c) => c.label !== "Client Payments"),
    expense,
    clients,
    projects,
    vendors,
    employees,
    services,
    bills: bills.map<Option>((b) => ({ value: b.id, label: `${b.vendor.name} · ${b.billNumber} · due ₹${b.total.minus(b.amountPaid).toFixed(2)}` })),
    subscriptions: subs.map<Option>((s) => ({ value: s.id, label: s.name })),
  };
}

export type TxnOptions = Awaited<ReturnType<typeof txnFormOptions>>;

export function incomeFields(o: TxnOptions): FieldDef[] {
  return [
    { name: "type", label: "", type: "hidden" },
    { name: "date", label: "Date", type: "date", required: true },
    { name: "amount", label: "Amount (₹)", type: "money", required: true },
    { name: "description", label: "Description", required: true, span: 2 },
    { name: "categoryId", label: "Category", type: "select", options: o.income, required: true, hint: "Invoice payments are recorded from the invoice page" },
    { name: "accountId", label: "Received in", type: "select", options: o.accounts, required: true },
    { name: "method", label: "Method", type: "select", options: PAYMENT_METHOD_OPTIONS },
    { name: "reference", label: "Reference / UTR" },
    { name: "clientId", label: "Client", type: "select", options: o.clients },
    { name: "projectId", label: "Project", type: "select", options: o.projects },
    { name: "serviceId", label: "Service", type: "select", options: o.services },
    { name: "attachment", label: "Attach receipt", type: "file", accept: "application/pdf,image/*" },
  ];
}

export function expenseFields(o: TxnOptions): FieldDef[] {
  return [
    { name: "type", label: "", type: "hidden" },
    { name: "date", label: "Date", type: "date", required: true },
    { name: "amount", label: "Amount paid (₹)", type: "money", required: true, hint: "Total including GST" },
    { name: "description", label: "Description", required: true, span: 2 },
    { name: "categoryId", label: "Category", type: "select", options: o.expense, required: true },
    { name: "accountId", label: "Paid from", type: "select", options: o.accounts, required: true },
    { name: "taxAmount", label: "Claimable input GST (₹)", type: "money", hint: "Leave 0 if not claimable" },
    { name: "method", label: "Method", type: "select", options: PAYMENT_METHOD_OPTIONS },
    { name: "reference", label: "Reference" },
    { name: "vendorId", label: "Vendor", type: "select", options: o.vendors },
    { name: "vendorBillId", label: "Pays vendor bill", type: "select", options: o.bills, hint: "Links the payment to a purchase bill" },
    { name: "employeeId", label: "Employee / freelancer", type: "select", options: o.employees },
    { name: "payrollMonth", label: "Payroll month", placeholder: "YYYY-MM", hint: "For salary / payout" },
    { name: "subscriptionId", label: "Subscription", type: "select", options: o.subscriptions },
    { name: "clientId", label: "Client (billable)", type: "select", options: o.clients },
    { name: "projectId", label: "Project", type: "select", options: o.projects },
    { name: "serviceId", label: "Service", type: "select", options: o.services },
    { name: "attachment", label: "Attach bill / receipt", type: "file", accept: "application/pdf,image/*" },
  ];
}

export function transferFields(o: TxnOptions): FieldDef[] {
  return [
    { name: "type", label: "", type: "hidden" },
    { name: "date", label: "Date", type: "date", required: true },
    { name: "amount", label: "Amount (₹)", type: "money", required: true },
    { name: "accountId", label: "From account", type: "select", options: o.accounts, required: true },
    { name: "toAccountId", label: "To account", type: "select", options: o.accounts, required: true },
    { name: "description", label: "Description", required: true, span: 2 },
    { name: "reference", label: "Reference" },
  ];
}
