"use client";

// Chart components (Recharts). Single y-axis per chart; categorical hues in fixed
// order (validated for CVD in light & dark); legends for ≥2 series; hover tooltips.
import * as React from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart,
} from "recharts";
import { formatMoney, type DisplayCurrency } from "@/lib/money";

const C = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

function useFmt(currency: DisplayCurrency) {
  return React.useMemo(
    () => ({
      full: (v: number) => formatMoney(v * currency.rateToInr, { currency }),
      compact: (v: number) => formatMoney(v * currency.rateToInr, { currency, compact: true }),
    }),
    [currency],
  );
}

/** Values arrive already converted to the display currency. */
function convertRows<T extends Record<string, unknown>>(rows: T[], keys: string[], currency: DisplayCurrency): T[] {
  if (currency.code === "INR") return rows;
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    for (const k of keys) if (typeof r[k] === "number") out[k] = (r[k] as number) / currency.rateToInr;
    return out as T;
  });
}

const axisProps = {
  tick: { fill: "var(--muted)", fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
} as const;

function TooltipBox({ active, payload, label, fmt }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-1 font-medium text-fg">{label}</p> : null}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="tabular ml-auto pl-4 font-medium text-fg">{fmt(Number(p.value ?? 0))}</span>
        </div>
      ))}
    </div>
  );
}

function ChartEmpty({ height, message = "No data for this period yet." }: { height: number; message?: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-line text-[13px] text-muted" style={{ height }}>
      {message}
    </div>
  );
}

export type SeriesPoint = { label: string; [k: string]: number | string };

/** Grouped bars over time, e.g. Revenue vs Expenses. */
export function GroupedBars({
  data,
  series,
  currency,
  height = 280,
}: {
  data: SeriesPoint[];
  series: { key: string; name: string }[];
  currency: DisplayCurrency;
  height?: number;
}) {
  const fmt = useFmt(currency);
  const rows = convertRows(data, series.map((s) => s.key), currency);
  if (!data.length || data.every((d) => series.every((s) => !Number(d[s.key])))) return <ChartEmpty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} axisLine={false} width={72} tickFormatter={fmt.compact} />
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<TooltipBox fmt={fmt.full} />} />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={C[i]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Line trend (single axis). Optional zero reference line for profit/loss. */
export function TrendLines({
  data,
  series,
  currency,
  height = 280,
  zeroLine = true,
}: {
  data: SeriesPoint[];
  series: { key: string; name: string; dashed?: boolean; colorIndex?: number }[];
  currency: DisplayCurrency;
  height?: number;
  zeroLine?: boolean;
}) {
  const fmt = useFmt(currency);
  const rows = convertRows(data, series.map((s) => s.key), currency);
  if (!data.length || data.every((d) => series.every((s) => !Number(d[s.key])))) return <ChartEmpty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} axisLine={false} width={72} tickFormatter={fmt.compact} />
        {zeroLine ? <ReferenceLine y={0} stroke="var(--border-strong)" /> : null}
        <Tooltip cursor={{ stroke: "var(--border-strong)" }} content={<TooltipBox fmt={fmt.full} />} />
        {series.length > 1 ? <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} /> : null}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={C[s.colorIndex ?? i]}
            strokeWidth={2}
            strokeDasharray={s.dashed ? "5 4" : undefined}
            dot={{ r: 3, strokeWidth: 2, fill: "var(--surface)" }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Cash in / out bars with a net-cash line (same unit, one axis). */
export function CashFlowChart({ data, currency, height = 280 }: { data: SeriesPoint[]; currency: DisplayCurrency; height?: number }) {
  const fmt = useFmt(currency);
  const rows = convertRows(data, ["cashIn", "cashOut", "netCash"], currency).map((r) => ({ ...r, cashOutNeg: -Number(r.cashOut) }));
  if (!data.length || data.every((d) => !Number(d.cashIn) && !Number(d.cashOut))) return <ChartEmpty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} stackOffset="sign" margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} axisLine={false} width={72} tickFormatter={fmt.compact} />
        <ReferenceLine y={0} stroke="var(--border-strong)" />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={({ active, payload, label }) => (
            <TooltipBox
              active={active}
              label={label as string}
              fmt={fmt.full}
              payload={(payload as unknown as { name?: string; value?: number; color?: string }[] | undefined)?.map((p) => ({ ...p, value: Math.abs(Number(p.value)) * (p.name === "Net cash flow" ? Math.sign(Number(p.value)) : 1) }))}
            />
          )}
        />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
        <Bar dataKey="cashIn" name="Cash in" stackId="cf" fill={C[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="cashOutNeg" name="Cash out" stackId="cf" fill={C[1]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line type="monotone" dataKey="netCash" name="Net cash flow" stroke={C[3]} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: "var(--surface)" }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Ranked horizontal bars (magnitude by category). One hue; labels carry identity. */
export function RankedBars({
  data,
  currency,
  height,
  colorIndex = 0,
  signed = false,
  emptyMessage,
}: {
  data: { name: string; value: number }[];
  currency: DisplayCurrency;
  height?: number;
  colorIndex?: number;
  signed?: boolean;
  emptyMessage?: string;
}) {
  const fmt = useFmt(currency);
  const rows = data.map((d) => ({ ...d, value: currency.code === "INR" ? d.value : d.value / currency.rateToInr }));
  const h = height ?? Math.max(160, rows.length * 34 + 30);
  if (!rows.length) return <ChartEmpty height={160} message={emptyMessage} />;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
        <XAxis type="number" {...axisProps} tickFormatter={fmt.compact} />
        <YAxis type="category" dataKey="name" {...axisProps} width={150} tick={{ fill: "var(--fg)", fontSize: 12 }} interval={0} />
        {signed ? <ReferenceLine x={0} stroke="var(--border-strong)" /> : null}
        <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<TooltipBox fmt={fmt.full} />} />
        <Bar dataKey="value" name="Amount" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {rows.map((r) => (
            <Cell key={r.name} fill={signed && r.value < 0 ? C[1] : C[colorIndex]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
