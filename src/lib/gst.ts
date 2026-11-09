// GST-aware document calculator. Pure and shared by server (authoritative) and
// client (live preview). Nothing here assumes registration or a rate: the
// caller passes `gstApplicable`, place-of-supply and per-line rates.
import { D, Decimal, round2 } from "./money";

export type LineInput = {
  quantity: Decimal.Value;
  unitPrice: Decimal.Value;
  discountPercent?: Decimal.Value | null;
  taxRate?: Decimal.Value | null;
};

export type LineResult = {
  lineSubtotal: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  taxAmount: Decimal;
  total: Decimal;
  taxRate: Decimal;
};

export type DocOptions = { gstApplicable: boolean; interState: boolean; roundOff: boolean };

export function computeLine(line: LineInput, opts: Omit<DocOptions, "roundOff">): LineResult {
  const qty = D(line.quantity);
  const price = D(line.unitPrice);
  const discPct = D(line.discountPercent ?? 0);
  const rate = opts.gstApplicable ? D(line.taxRate ?? 0) : new Decimal(0);
  const lineSubtotal = round2(qty.times(price));
  const discountAmount = round2(lineSubtotal.times(discPct).dividedBy(100));
  const taxableAmount = lineSubtotal.minus(discountAmount);
  const taxAmount = round2(taxableAmount.times(rate).dividedBy(100));
  let cgstAmount = new Decimal(0);
  let sgstAmount = new Decimal(0);
  let igstAmount = new Decimal(0);
  if (opts.interState) {
    igstAmount = taxAmount;
  } else {
    cgstAmount = round2(taxAmount.dividedBy(2));
    sgstAmount = taxAmount.minus(cgstAmount);
  }
  return {
    lineSubtotal,
    discountAmount,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    taxAmount,
    total: taxableAmount.plus(taxAmount),
    taxRate: rate,
  };
}

export type DocResult = {
  lines: LineResult[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  taxTotal: Decimal;
  roundOff: Decimal;
  total: Decimal;
  taxBreakup: { rate: string; taxable: Decimal; tax: Decimal }[];
};

export function computeDocument(lines: LineInput[], opts: DocOptions): DocResult {
  const results = lines.map((l) => computeLine(l, opts));
  const z = () => new Decimal(0);
  const totals = results.reduce(
    (acc, r) => ({
      subtotal: acc.subtotal.plus(r.lineSubtotal),
      discountTotal: acc.discountTotal.plus(r.discountAmount),
      taxableAmount: acc.taxableAmount.plus(r.taxableAmount),
      cgstAmount: acc.cgstAmount.plus(r.cgstAmount),
      sgstAmount: acc.sgstAmount.plus(r.sgstAmount),
      igstAmount: acc.igstAmount.plus(r.igstAmount),
      taxTotal: acc.taxTotal.plus(r.taxAmount),
    }),
    { subtotal: z(), discountTotal: z(), taxableAmount: z(), cgstAmount: z(), sgstAmount: z(), igstAmount: z(), taxTotal: z() },
  );
  const gross = totals.taxableAmount.plus(totals.taxTotal);
  const total = opts.roundOff ? gross.toDecimalPlaces(0, Decimal.ROUND_HALF_UP) : gross;
  const breakup = new Map<string, { rate: string; taxable: Decimal; tax: Decimal }>();
  results.forEach((r) => {
    const key = r.taxRate.toFixed(2);
    const b = breakup.get(key) ?? { rate: key, taxable: z(), tax: z() };
    b.taxable = b.taxable.plus(r.taxableAmount);
    b.tax = b.tax.plus(r.taxAmount);
    breakup.set(key, b);
  });
  return { lines: results, ...totals, roundOff: total.minus(gross), total, taxBreakup: [...breakup.values()] };
}

/** Inter-state supply ⇒ IGST; intra-state ⇒ CGST + SGST. Export (non-India) ⇒ IGST. */
export function isInterStateSupply(opts: {
  supplierStateCode?: string | null;
  placeOfSupply?: string | null;
  clientCountry?: string | null;
}): boolean {
  if (opts.clientCountry && opts.clientCountry.trim().toLowerCase() !== "india") return true;
  if (!opts.supplierStateCode || !opts.placeOfSupply) return false;
  return opts.supplierStateCode !== opts.placeOfSupply;
}

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" }, { code: "02", name: "Himachal Pradesh" }, { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" }, { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" }, { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" }, { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" }, { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" }, { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" }, { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" }, { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" }, { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" }, { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" }, { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" }, { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" }, { code: "38", name: "Ladakh" }, { code: "97", name: "Other Territory" },
];

export function stateName(code?: string | null) {
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? null;
}
