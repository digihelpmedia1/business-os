// Default prefixes. Number format: PREFIX/FY/0001 (e.g. INV/26-27/0001 — 14 chars,
// within the GST limit of 16 characters for invoice serial numbers).
export const DEFAULT_SERIES: { docType: string; prefix: string; label: string }[] = [
  { docType: "TAX_INVOICE", prefix: "INV", label: "GST Tax Invoice" },
  { docType: "NON_GST", prefix: "BOS", label: "Non-GST Invoice / Bill of Supply" },
  { docType: "PROFORMA", prefix: "PI", label: "Proforma Invoice" },
  { docType: "ADVANCE", prefix: "ADV", label: "Advance Invoice" },
  { docType: "CREDIT_NOTE", prefix: "CN", label: "Credit Note" },
  { docType: "DEBIT_NOTE", prefix: "DN", label: "Debit Note" },
  { docType: "RECEIPT", prefix: "RCT", label: "Payment Receipt" },
  { docType: "PROPOSAL", prefix: "PRP", label: "Proposal" },
  { docType: "QUOTATION", prefix: "QT", label: "Quotation" },
  { docType: "ESTIMATE", prefix: "EST", label: "Estimate" },
];

export function formatNumber(prefix: string, fyShort: string | null, seq: number, padding: number) {
  const n = String(seq).padStart(padding, "0");
  return fyShort ? `${prefix}/${fyShort}/${n}` : `${prefix}/${n}`;
}
