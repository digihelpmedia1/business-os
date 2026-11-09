import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { withParams, type SearchParams } from "@/lib/list";
import { Card, EmptyState } from "./primitives";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  sortKey?: string;
  className?: string;
  align?: "left" | "right" | "center";
  render: (row: T) => React.ReactNode;
};

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  basePath,
  searchParams = {},
  sort,
  dir,
  total,
  page = 1,
  pageSize = 20,
  toolbar,
  empty,
  footer,
  className,
  rowHref,
}: {
  columns: Column<T>[];
  rows: T[];
  basePath: string;
  searchParams?: SearchParams;
  sort?: string;
  dir?: "asc" | "desc";
  total?: number;
  page?: number;
  pageSize?: number;
  toolbar?: React.ReactNode;
  empty?: { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode };
  footer?: React.ReactNode;
  className?: string;
  rowHref?: (row: T) => string | null;
}) {
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return (
    <Card className={cn("overflow-hidden", className)}>
      {toolbar}
      {rows.length === 0 ? (
        <EmptyState title={empty?.title ?? "No records found"} description={empty?.description} icon={empty?.icon} action={empty?.action} />
      ) : (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                {columns.map((c) => {
                  const active = c.sortKey && sort === c.sortKey;
                  const nextDir = active && dir === "asc" ? "desc" : "asc";
                  return (
                    <th
                      key={c.key}
                      className={cn(
                        "whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-muted",
                        c.align === "right" && "text-right",
                        c.align === "center" && "text-center",
                        c.className,
                      )}
                    >
                      {c.sortKey ? (
                        <Link
                          href={withParams(basePath, searchParams, { sort: c.sortKey, dir: nextDir, page: null })}
                          className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}
                          scroll={false}
                        >
                          {c.header}
                          {active ? dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </Link>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = rowHref?.(row);
                return (
                  <tr key={row.id} className="group border-b border-line last:border-0 hover:bg-surface-2/60">
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-4 py-3 align-middle text-fg",
                          c.align === "right" && "tabular text-right",
                          c.align === "center" && "text-center",
                          c.className,
                        )}
                      >
                        {href && i === 0 ? (
                          <Link href={href} className="font-medium text-fg hover:text-brand">
                            {c.render(row)}
                          </Link>
                        ) : (
                          c.render(row)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            {footer}
          </table>
        </div>
      )}
      {total !== undefined && total > 0 ? (
        <div className="flex flex-col items-center justify-between gap-2 border-t border-line px-4 py-3 text-[13px] text-muted sm:flex-row">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <PageLink disabled={page <= 1} href={withParams(basePath, searchParams, { page: page - 1 })}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </PageLink>
            <span className="px-2">
              Page {page} of {pages}
            </span>
            <PageLink disabled={page >= pages} href={withParams(basePath, searchParams, { page: page + 1 })}>
              Next <ChevronRight className="h-4 w-4" />
            </PageLink>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled?: boolean; children: React.ReactNode }) {
  if (disabled)
    return <span className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 opacity-40">{children}</span>;
  return (
    <Link href={href} scroll={false} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 hover:bg-surface-2 hover:text-fg">
      {children}
    </Link>
  );
}

/** Simple tab navigation using links. */
export function LinkTabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <div className="thin-scroll mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            active === t.key ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-xs text-muted">{t.count}</span> : null}
        </Link>
      ))}
    </div>
  );
}
