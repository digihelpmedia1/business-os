import Decimal from "decimal.js";

export { Decimal };

type Decimalish = Decimal.Value | { toString(): string } | null | undefined;

/** Safe Decimal constructor: null/undefined/"" → 0. Accepts Prisma.Decimal. */
export function D(value: Decimalish): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (typeof value === "number" || typeof value === "string") return new Decimal(value);
  if (value instanceof Decimal) return value;
  return new Decimal(value.toString());
}

export function round2(value: Decimalish): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function num(value: Decimalish): number {
  return D(value).toNumber();
}

export function sum(values: Decimalish[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/** Display currency used for analytics views. Books are always kept in INR. */
export type DisplayCurrency = { code: string; rateToInr: number; asOf?: string | null; source?: string | null };
export const INR: DisplayCurrency = { code: "INR", rateToInr: 1 };

export const SUPPORTED_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "AUD", "CAD", "SGD", "JPY", "CHF", "NZD", "HKD", "SAR", "QAR",
  "ZAR", "SEK", "NOK", "DKK", "CNY", "MYR", "THB", "IDR", "PHP", "KRW", "BRL", "MXN", "TRY", "PLN",
] as const;

/** Convert an INR amount to the display currency (number). */
export function convert(inrValue: Decimalish, ccy: DisplayCurrency = INR): number {
  const v = num(inrValue);
  if (ccy.code === "INR" || !(ccy.rateToInr > 0)) return v;
  return v / ccy.rateToInr;
}

/** Format an INR amount, optionally converted to a display currency. */
export function formatMoney(
  inrValue: Decimalish,
  opts: { currency?: DisplayCurrency; compact?: boolean; decimals?: number } = {},
): string {
  const ccy = opts.currency ?? INR;
  const value = convert(inrValue, ccy);
  const locale = ccy.code === "INR" ? "en-IN" : "en-US";
  if (opts.compact && Math.abs(value) >= 1000) {
    if (ccy.code === "INR") {
      const abs = Math.abs(value);
      const sign = value < 0 ? "-" : "";
      if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
      if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
      return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
    }
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: ccy.code,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  const decimals = opts.decimals ?? 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: ccy.code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Plain INR formatting used on legal documents (invoices, receipts). */
export function inr(value: Decimalish) {
  return formatMoney(value);
}

/** Amount in words using the Indian numbering system (for invoices). */
export function amountInWords(value: Decimalish): string {
  const amount = round2(value).abs();
  const rupees = amount.floor().toNumber();
  const paise = amount.minus(amount.floor()).times(100).round().toNumber();
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
    "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number): string => (n < 20 ? ones[n]! : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
  const three = (n: number): string => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? `${ones[h]} Hundred` : "", r ? two(r) : ""].filter(Boolean).join(" ");
  };
  const words = (n: number): string => {
    if (n === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(n / 1e7);
    const lakh = Math.floor((n % 1e7) / 1e5);
    const thousand = Math.floor((n % 1e5) / 1e3);
    const rest = n % 1e3;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(" ");
  };
  let out = `Rupees ${words(rupees)}`;
  if (paise) out += ` and ${two(paise)} Paise`;
  return `${out} Only`;
}
