"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, KeyRound, LogOut, Menu, Moon, Search, Sun, UserRound } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { globalSearch, logout, setDisplayCurrency, type SearchResult } from "@/server/shell";

export function Topbar({
  user,
  unread,
  currency,
  currencies,
  onMenu,
}: {
  user: { name: string; email: string; roleName: string };
  unread: number;
  currency: string;
  currencies: string[];
  onMenu: () => void;
}) {
  return (
    <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <CurrencySwitcher value={currency} options={currencies} />
        <ThemeToggle />
        <Link href="/notifications" className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Notifications">
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Link>
        <UserMenu user={user} />
      </div>
    </header>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, []);

  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setResults(await globalSearch(q));
        setActive(0);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (r: SearchResult) => {
    setOpen(false);
    setQ("");
    router.push(r.href);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && results[active]) go(results[active]!);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search clients, invoices, projects…"
        className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-14 text-sm text-fg placeholder:text-subtle focus:border-brand focus:bg-surface focus:outline-none focus:ring-3 focus:ring-[var(--ring)]"
        aria-label="Global search"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 text-[10px] text-subtle sm:block">Ctrl K</kbd>
      {open && q.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
          {loading && results.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted">Searching…</p> : null}
          {!loading && results.length === 0 ? <p className="px-3 py-3 text-[13px] text-muted">No matches for “{q}”.</p> : null}
          {results.map((r, i) => (
            <button
              key={`${r.href}-${i}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left", i === active ? "bg-surface-2" : "")}
            >
              <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-subtle">{r.type}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-fg">{r.label}</span>
                {r.sub ? <span className="block truncate text-xs text-muted">{r.sub}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CurrencySwitcher({ value, options }: { value: string; options: string[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  if (options.length <= 1) return null;
  return (
    <select
      value={value}
      disabled={pending}
      title="Display currency for dashboards and reports (books are kept in INR)"
      aria-label="Display currency"
      onChange={(e) =>
        start(async () => {
          await setDisplayCurrency(e.target.value);
          router.refresh();
        })
      }
      className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] font-medium text-fg"
    >
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("dhm-theme", next ? "dark" : "light");
        } catch {
          /* ignore */
        }
      }}
      className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}

function UserMenu({ user }: { user: { name: string; email: string; roleName: string } }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2" aria-label="Account menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{initials(user.name)}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-line bg-surface p-1 shadow-xl">
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-medium text-fg">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-1 text-[11px] font-medium text-brand">{user.roleName}</p>
          </div>
          <Link href="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface-2">
            <UserRound className="h-4 w-4 text-muted" /> My profile
          </Link>
          <Link href="/profile#password" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg hover:bg-surface-2">
            <KeyRound className="h-4 w-4 text-muted" /> Change password
          </Link>
          <form action={logout}>
            <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-soft">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
