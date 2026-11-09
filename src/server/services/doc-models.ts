import "server-only";
import type { Invoice, InvoiceItem, Quote, QuoteItem, Client, CompanySettings } from "@prisma/client";
import { fmtDate } from "@/lib/dates";
import { stateName } from "@/lib/gst";
import { invoiceOutstanding } from "@/lib/finance/ledger";
import { INVOICE_TYPE_LABELS } from "@/lib/finance/constants";
import type { PreviewDoc } from "@/components/billing/doc-preview";

const QUOTE_HEADINGS = { PROPOSAL: "Proposal", QUOTATION: "Quotation", ESTIMATE: "Service Estimate" } as const;

export function quotePreview(q: Quote & { items: QuoteItem[]; client: Client }): PreviewDoc {
  return {
    heading: QUOTE_HEADINGS[q.kind],
    number: q.version > 1 ? `${q.number}` : q.number,
    meta: [
      { label: "Date", value: fmtDate(q.issueDate) },
      ...(q.expiryDate ? [{ label: "Valid until", value: fmtDate(q.expiryDate) }] : []),
      ...(q.version > 1 ? [{ label: "Version", value: String(q.version) }] : []),
      ...(q.gstApplicable && q.placeOfSupply ? [{ label: "Place of supply", value: `${q.placeOfSupply} — ${stateName(q.placeOfSupply) ?? ""}` }] : []),
    ],
    billTo: {
      name: q.client.businessName || q.client.name,
      lines: [
        q.client.businessName && q.client.businessName !== q.client.name ? `Attn: ${q.client.contactPerson || q.client.name}` : q.client.contactPerson,
        [q.client.billingAddress, q.client.city, q.client.state, q.client.pincode].filter(Boolean).join(", "),
        q.client.gstin ? `GSTIN: ${q.client.gstin}` : null,
        [q.client.email, q.client.phone].filter(Boolean).join(" · "),
      ],
    },
    items: q.items,
    gstApplicable: q.gstApplicable,
    isInterState: q.isInterState,
    totals: { subtotal: q.subtotal, discountTotal: q.discountTotal, taxableAmount: q.taxableAmount, taxTotal: q.taxTotal, roundOff: q.roundOff, total: q.total },
    sections: [
      { title: "Introduction", body: q.introduction },
      { title: "Scope of work", body: q.scopeOfWork },
      { title: "Deliverables", body: q.deliverables },
      { title: "Project timeline", body: q.timeline },
      { title: "Payment terms", body: q.paymentTerms },
      { title: "Terms & conditions", body: q.terms },
    ],
    showBank: false,
    watermark: q.status === "DRAFT" ? "Draft" : q.status === "REJECTED" ? "Rejected" : q.status === "EXPIRED" ? "Expired" : null,
  };
}

export function invoicePreview(inv: Invoice & { items: InvoiceItem[]; client: Client; relatedInvoice?: Invoice | null }, company: CompanySettings): PreviewDoc {
  const heading =
    inv.type === "TAX_INVOICE" ? "Tax Invoice" : inv.type === "NON_GST" ? (company.gstRegistered ? "Bill of Supply" : "Invoice") : INVOICE_TYPE_LABELS[inv.type];
  return {
    heading,
    number: inv.number ?? "DRAFT",
    meta: [
      { label: inv.type === "CREDIT_NOTE" || inv.type === "DEBIT_NOTE" ? "Note date" : "Invoice date", value: fmtDate(inv.issueDate) },
      ...(inv.dueDate && inv.type !== "CREDIT_NOTE" ? [{ label: "Due date", value: fmtDate(inv.dueDate) }] : []),
      ...(inv.periodLabel ? [{ label: "Period", value: inv.periodLabel }] : []),
      ...(inv.relatedInvoice ? [{ label: "Against invoice", value: `${inv.relatedInvoice.number} (${fmtDate(inv.relatedInvoice.issueDate)})` }] : []),
      ...(inv.gstApplicable && inv.placeOfSupply ? [{ label: "Place of supply", value: `${inv.placeOfSupply} — ${stateName(inv.placeOfSupply) ?? ""}` }] : []),
      ...(inv.gstApplicable ? [{ label: "Reverse charge", value: inv.reverseCharge ? "Yes" : "No" }] : []),
    ],
    billTo: {
      name: inv.clientName ?? inv.client.businessName ?? inv.client.name,
      lines: [
        inv.clientAddress,
        inv.clientGstin ? `GSTIN: ${inv.clientGstin}` : inv.gstApplicable ? "Unregistered recipient" : null,
        inv.clientStateCode ? `State: ${stateName(inv.clientStateCode)} (${inv.clientStateCode})` : null,
        [inv.client.email, inv.client.phone].filter(Boolean).join(" · "),
      ],
    },
    items: inv.items,
    gstApplicable: inv.gstApplicable,
    isInterState: inv.isInterState,
    totals: {
      subtotal: inv.subtotal, discountTotal: inv.discountTotal, taxableAmount: inv.taxableAmount, cgstAmount: inv.cgstAmount, sgstAmount: inv.sgstAmount,
      igstAmount: inv.igstAmount, taxTotal: inv.taxTotal, roundOff: inv.roundOff, total: inv.total,
      paid: inv.type === "CREDIT_NOTE" ? undefined : inv.amountPaid.plus(inv.amountCredited),
      balance: inv.type === "CREDIT_NOTE" ? undefined : invoiceOutstanding(inv),
    },
    sections: [
      { title: "Reason", body: inv.reason },
      { title: "Notes", body: inv.notes },
      { title: "Payment terms", body: inv.paymentTerms },
      { title: "Terms & conditions", body: inv.terms },
    ],
    showBank: inv.type !== "CREDIT_NOTE",
    watermark: inv.status === "DRAFT" ? "Draft" : inv.status === "CANCELLED" ? "Cancelled" : inv.status === "PAID" ? null : null,
  };
}
