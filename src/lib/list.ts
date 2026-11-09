// Parse list-page URL params (search, sort, pagination, filters).
export type SearchParams = Record<string, string | string[] | undefined>;

export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s.trim() : undefined;
}

export type ListParams<S extends string> = {
  q?: string;
  page: number;
  pageSize: number;
  skip: number;
  sort: S;
  dir: "asc" | "desc";
};

export function parseList<S extends string>(
  sp: SearchParams,
  opts: { sortable: readonly S[]; defaultSort: S; defaultDir?: "asc" | "desc"; pageSize?: number },
): ListParams<S> {
  const pageSize = Math.min(Math.max(Number(param(sp, "size")) || opts.pageSize || 20, 5), 100);
  const page = Math.max(Number(param(sp, "page")) || 1, 1);
  const sortParam = param(sp, "sort") as S | undefined;
  const sort = sortParam && opts.sortable.includes(sortParam) ? sortParam : opts.defaultSort;
  const dirParam = param(sp, "dir");
  const dir = dirParam === "asc" || dirParam === "desc" ? dirParam : (opts.defaultDir ?? "desc");
  return { q: param(sp, "q"), page, pageSize, skip: (page - 1) * pageSize, sort, dir };
}

/** Build a URL keeping current params and overriding some. */
export function withParams(base: string, sp: SearchParams, overrides: Record<string, string | number | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) usp.set(k, s);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null || v === "") usp.delete(k);
    else usp.set(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}

/** orderBy entry; `nulls: "last"` is only valid on nullable columns. */
export function orderByField(sort: string, dir: "asc" | "desc", nullable: readonly string[] = []) {
  return { [sort]: nullable.includes(sort) ? { sort: dir, nulls: "last" as const } : dir };
}
