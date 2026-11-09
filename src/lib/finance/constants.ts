import type { CategoryKind, InvoiceStatus, InvoiceType } from "@prisma/client";

/** Invoice types that recognise revenue (credit notes reduce it). */
export const REVENUE_INVOICE_TYPES: InvoiceType[] = ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"];
/** Invoice types that create a receivable (client owes money). */
export const RECEIVABLE_TYPES: InvoiceType[] = ["TAX_INVOICE", "NON_GST", "DEBIT_NOTE"];
/** Payment-request documents that are not revenue (customer advances). */
export const ADVANCE_TYPES: InvoiceType[] = ["PROFORMA", "ADVANCE"];
/** Statuses that count as "issued" (not draft, not cancelled). */
export const LIVE_STATUSES: InvoiceStatus[] = ["ISSUED", "PARTIALLY_PAID", "PAID"];
export const OPEN_STATUSES: InvoiceStatus[] = ["ISSUED", "PARTIALLY_PAID"];

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  TAX_INVOICE: "GST Tax Invoice",
  NON_GST: "Non-GST Invoice",
  PROFORMA: "Proforma Invoice",
  ADVANCE: "Advance Invoice",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
};

export const CATEGORY_KIND_LABELS: Record<CategoryKind, { label: string; help: string }> = {
  REVENUE: { label: "Operating revenue", help: "Service income. Counted in revenue." },
  OTHER_INCOME: { label: "Other income", help: "Interest, refunds, misc. income — below operating profit." },
  COST_OF_SERVICES: { label: "Cost of services", help: "Direct delivery costs — reduces gross profit." },
  OPERATING_EXPENSE: { label: "Operating expense", help: "Overheads — reduces operating profit." },
  NON_OPERATING: { label: "Non-operating expense", help: "Bank charges, interest, penalties — below operating profit." },
  CAPITAL_EXPENDITURE: { label: "Capital expenditure", help: "Equipment & assets — not in P&L, shown as investing cash flow." },
  TAX_SETTLEMENT: { label: "Tax payment / refund", help: "GST / TDS paid to government — settles a liability, not in P&L." },
  OWNER_EQUITY: { label: "Owner capital / drawings", help: "Capital introduced or withdrawn — financing, not in P&L." },
};

export const INCOME_KINDS: CategoryKind[] = ["REVENUE", "OTHER_INCOME", "CAPITAL_EXPENDITURE", "TAX_SETTLEMENT", "OWNER_EQUITY"];
export const EXPENSE_KINDS: CategoryKind[] = [
  "COST_OF_SERVICES", "OPERATING_EXPENSE", "NON_OPERATING", "CAPITAL_EXPENDITURE", "TAX_SETTLEMENT", "OWNER_EQUITY",
];
