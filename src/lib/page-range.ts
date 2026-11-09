import "server-only";
import { param, type SearchParams } from "./list";
import { isoDate, resolveRange } from "./dates";
import { getSettings } from "./settings";

/** Resolve the ?range=&from=&to= filter used by dashboards and reports. */
export async function pageRange(sp: SearchParams, fallback = "this_month") {
  const settings = await getSettings();
  const range = resolveRange(param(sp, "range") ?? fallback, { from: param(sp, "from"), to: param(sp, "to") }, settings.fyStartMonth);
  return { ...range, fromIso: isoDate(range.from), toIso: isoDate(range.to), fyStartMonth: settings.fyStartMonth };
}
