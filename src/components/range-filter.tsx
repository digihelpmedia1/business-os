"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RANGE_PRESETS } from "@/lib/dates";
import { Input, Select } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";

export function RangeFilter({ preset, from, to }: { preset: string; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [value, setValue] = React.useState(preset);
  const [f, setF] = React.useState(from);
  const [t, setT] = React.useState(to);
  const [pending, start] = React.useTransition();

  const apply = (next: Record<string, string>) => {
    const usp = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) (v ? usp.set(k, v) : usp.delete(k));
    start(() => router.replace(`${pathname}?${usp.toString()}`, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Period"
        value={value}
        disabled={pending}
        onChange={(e) => {
          setValue(e.target.value);
          if (e.target.value !== "custom") apply({ range: e.target.value, from: "", to: "" });
        }}
        className="w-auto min-w-[190px]"
      >
        {RANGE_PRESETS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      {value === "custom" ? (
        <>
          <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="w-auto" aria-label="From" />
          <span className="text-muted">–</span>
          <Input type="date" value={t} onChange={(e) => setT(e.target.value)} className="w-auto" aria-label="To" />
          <Button size="md" disabled={!f || !t || f > t || pending} onClick={() => apply({ range: "custom", from: f, to: t })}>
            Apply
          </Button>
        </>
      ) : null}
    </div>
  );
}
