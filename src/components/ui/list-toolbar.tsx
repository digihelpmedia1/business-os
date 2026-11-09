"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input, Select } from "./fields";
import { Button } from "./button";

export type FilterDef =
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[] }
  | { type: "date"; name: string; label: string };

/** Search box + filters that write to the URL (server components re-query). */
export function ListToolbar({
  filters = [],
  placeholder = "Search…",
  children,
}: {
  filters?: FilterDef[];
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = React.useState(sp.get("q") ?? "");
  const [, startTransition] = React.useTransition();

  const update = React.useCallback(
    (changes: Record<string, string>) => {
      const usp = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(changes)) {
        if (v) usp.set(k, v);
        else usp.delete(k);
      }
      usp.delete("page");
      startTransition(() => router.replace(`${pathname}?${usp.toString()}`, { scroll: false }));
    },
    [pathname, router, sp],
  );

  React.useEffect(() => {
    const current = sp.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => update({ q }), 350);
    return () => clearTimeout(t);
  }, [q, sp, update]);

  const active = filters.some((f) => sp.get(f.name)) || !!sp.get("q");

  return (
    <div className="flex flex-col gap-2 border-b border-line p-3 lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1 lg:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" aria-label="Search" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) =>
          f.type === "select" ? (
            <Select
              key={f.name}
              aria-label={f.label}
              value={sp.get(f.name) ?? ""}
              onChange={(e) => update({ [f.name]: e.target.value })}
              className="w-auto min-w-[140px]"
            >
              <option value="">{f.label}: All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <label key={f.name} className="flex items-center gap-1.5 text-xs text-muted">
              {f.label}
              <Input
                type="date"
                value={sp.get(f.name) ?? ""}
                onChange={(e) => update({ [f.name]: e.target.value })}
                className="w-auto"
              />
            </label>
          ),
        )}
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              update(Object.fromEntries([["q", ""], ...filters.map((f) => [f.name, ""])]));
            }}
          >
            <X /> Clear
          </Button>
        ) : null}
        {children}
      </div>
    </div>
  );
}
