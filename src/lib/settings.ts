import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
import { INR, type DisplayCurrency } from "./money";
import { isoDate } from "./dates";

export const getSettings = cache(async () => {
  return (await db.companySettings.findUnique({ where: { id: 1 } })) ?? (await db.companySettings.create({ data: { id: 1 } }));
});

export const CURRENCY_COOKIE = "dhm_ccy";

/** The viewer's chosen display currency for analytics (books stay in INR). */
export const getDisplayCurrency = cache(async (): Promise<DisplayCurrency> => {
  const store = await cookies();
  const code = store.get(CURRENCY_COOKIE)?.value;
  if (!code || code === "INR") return INR;
  const rate = await db.exchangeRate.findUnique({ where: { currency: code } });
  if (!rate || Number(rate.rateToInr) <= 0) return INR;
  return { code, rateToInr: Number(rate.rateToInr), asOf: isoDate(rate.asOf), source: rate.source };
});

export async function getAvailableCurrencies(): Promise<string[]> {
  const rates = await db.exchangeRate.findMany({ select: { currency: true }, orderBy: { currency: "asc" } });
  return ["INR", ...rates.map((r) => r.currency).filter((c) => c !== "INR")];
}
