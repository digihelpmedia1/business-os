import { z } from "zod";
import { toDateOnly } from "./dates";
import { GSTIN_REGEX, PAN_REGEX } from "./gst";

const blankToUndefined = (v: unknown) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v);

/** Optional trimmed string; "" → null. */
export const optStr = (max = 500) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional()).transform((v) => v ?? null);

export const reqStr = (label: string, max = 200) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string({ error: `${label} is required` }).min(1, `${label} is required`).max(max));

/** Money as a validated string (kept exact for Decimal). */
export const money = (label = "Amount", { allowZero = true, allowNegative = false } = {}) =>
  z
    .preprocess(
      (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v.replace(/[,₹\s]/g, "") : v),
      z.string({ error: `${label} is required` }).regex(allowNegative ? /^-?\d{1,12}(\.\d{1,2})?$/ : /^\d{1,12}(\.\d{1,2})?$/, `${label} must be a valid amount (max 2 decimals)`),
    )
    .refine((v) => allowZero || Number(v) > 0, `${label} must be greater than zero`);

export const optMoney = (label = "Amount") =>
  z.preprocess(blankToUndefined, money(label).optional()).transform((v) => v ?? null);

export const percent = (label = "Rate") =>
  z.preprocess(
    (v) => (v === "" || v == null ? "0" : String(v)),
    z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, `${label} must be a number`).refine((v) => Number(v) <= 100, `${label} cannot exceed 100`),
  );

export const quantity = z.preprocess(
  (v) => (typeof v === "number" ? String(v) : v),
  z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Invalid quantity").refine((v) => Number(v) > 0, "Quantity must be greater than zero"),
);

export const dateStr = (label = "Date") =>
  z
    .string({ error: `${label} is required` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required`)
    .transform((v) => toDateOnly(v));

export const optDate = () =>
  z.preprocess(blankToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").optional()).transform((v) => (v ? toDateOnly(v) : null));

export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true || v === "1", z.boolean());

export const optId = z.preprocess(blankToUndefined, z.string().max(64).optional()).transform((v) => v ?? null);
export const reqId = (label: string) => z.string({ error: `${label} is required` }).min(1, `${label} is required`).max(64);

export const optInt = (min = 0, max = 100000) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional()).transform((v) => v ?? null);

export const email = z.preprocess(blankToUndefined, z.email("Invalid email address").optional()).transform((v) => v ?? null);

export const gstin = z
  .preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v), z.string().regex(GSTIN_REGEX, "Invalid GSTIN format").optional())
  .transform((v) => v ?? null);

export const pan = z
  .preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() || undefined : v), z.string().regex(PAN_REGEX, "Invalid PAN format").optional())
  .transform((v) => v ?? null);

export const phone = z
  .preprocess(blankToUndefined, z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, "Invalid phone number").optional())
  .transform((v) => v ?? null);

export const stateCode = z
  .preprocess(blankToUndefined, z.string().regex(/^\d{2}$/, "Invalid state code").optional())
  .transform((v) => v ?? null);

export function enumField<T extends Record<string, string>>(e: T, label = "Value") {
  return z.enum(e, { error: `Select a valid ${label.toLowerCase()}` });
}
