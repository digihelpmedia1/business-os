// All calendar dates are handled as "date-only" values: a JS Date at 00:00 UTC
// representing the Asia/Kolkata calendar day. This matches Postgres DATE columns.

export const TIMEZONE = "Asia/Kolkata";
const DAY = 86_400_000;

export function toDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

/** Today's date in India as a date-only value. */
export function todayIST(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return toDateOnly(parts);
}

export function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Format a real timestamp (timestamptz) in IST. */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  }).format(date);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY);
}

export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY);
}

export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(y!, m! - 1, 1)),
  );
}

export function monthLongLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Inclusive list of month keys (YYYY-MM) between two dates. */
export function monthsInRange(from: Date, to: Date): string[] {
  const out: string[] = [];
  let cur = startOfMonth(from);
  while (cur <= to) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

// ───────────── Financial year (India: April → March by default) ─────────────

export type Period = { from: Date; to: Date; label: string };

export function fyOf(d: Date, fyStartMonth = 4): Period & { short: string } {
  const m = d.getUTCMonth() + 1;
  const startYear = m >= fyStartMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const from = new Date(Date.UTC(startYear, fyStartMonth - 1, 1));
  const to = addDays(addMonths(from, 12), -1);
  const endYear = fyStartMonth === 1 ? startYear : startYear + 1;
  const label = fyStartMonth === 1 ? `FY ${startYear}` : `FY ${startYear}-${String(endYear).slice(2)}`;
  const short =
    fyStartMonth === 1 ? String(startYear).slice(2) : `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
  return { from, to, label, short };
}

export function quarterOf(d: Date, fyStartMonth = 4): Period {
  const fy = fyOf(d, fyStartMonth);
  const monthsIn = (d.getUTCFullYear() - fy.from.getUTCFullYear()) * 12 + d.getUTCMonth() - fy.from.getUTCMonth();
  const q = Math.floor(monthsIn / 3);
  const from = addMonths(fy.from, q * 3);
  return { from, to: addDays(addMonths(from, 3), -1), label: `Q${q + 1} ${fy.label}` };
}

export const RANGE_PRESETS = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "last_3_months", label: "Last 3 Months" },
  { value: "last_6_months", label: "Last 6 Months" },
  { value: "this_fy", label: "This Financial Year" },
  { value: "prev_fy", label: "Previous Financial Year" },
  { value: "custom", label: "Custom Range" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export function resolveRange(
  preset: string | undefined,
  custom: { from?: string; to?: string } = {},
  fyStartMonth = 4,
  today: Date = todayIST(),
): Period & { preset: RangePreset } {
  const p = (RANGE_PRESETS.some((r) => r.value === preset) ? preset : "this_month") as RangePreset;
  const som = startOfMonth(today);
  switch (p) {
    case "last_month": {
      const from = addMonths(som, -1);
      return { preset: p, from, to: endOfMonth(from), label: monthLongLabel(from) };
    }
    case "last_3_months":
      return { preset: p, from: addMonths(som, -2), to: endOfMonth(today), label: "Last 3 months" };
    case "last_6_months":
      return { preset: p, from: addMonths(som, -5), to: endOfMonth(today), label: "Last 6 months" };
    case "this_fy": {
      const fy = fyOf(today, fyStartMonth);
      return { preset: p, from: fy.from, to: fy.to, label: fy.label };
    }
    case "prev_fy": {
      const fy = fyOf(addMonths(fyOf(today, fyStartMonth).from, -1), fyStartMonth);
      return { preset: p, from: fy.from, to: fy.to, label: fy.label };
    }
    case "custom": {
      try {
        const from = toDateOnly(custom.from ?? "");
        const to = toDateOnly(custom.to ?? "");
        if (from <= to) return { preset: p, from, to, label: `${fmtDate(from)} – ${fmtDate(to)}` };
      } catch {
        /* fall through to default */
      }
      return { preset: "this_month", from: som, to: endOfMonth(today), label: monthLongLabel(today) };
    }
    default:
      return { preset: "this_month", from: som, to: endOfMonth(today), label: monthLongLabel(today) };
  }
}

/** The equally long period immediately before `period`. */
export function previousPeriod(period: { from: Date; to: Date }): Period {
  const isWholeMonths = period.from.getUTCDate() === 1 && addDays(period.to, 1).getUTCDate() === 1;
  if (isWholeMonths) {
    const months = monthsInRange(period.from, period.to).length;
    const from = addMonths(period.from, -months);
    return { from, to: addDays(period.from, -1), label: "Previous period" };
  }
  const len = daysBetween(period.from, period.to) + 1;
  return { from: addDays(period.from, -len), to: addDays(period.from, -1), label: "Previous period" };
}

export function periodBounds(type: "MONTH" | "QUARTER" | "YEAR", start: Date, fyStartMonth = 4): Period {
  if (type === "MONTH") return { from: startOfMonth(start), to: endOfMonth(start), label: monthLongLabel(start) };
  if (type === "QUARTER") return quarterOf(start, fyStartMonth);
  return fyOf(start, fyStartMonth);
}
