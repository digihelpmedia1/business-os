import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-[var(--shadow)]">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">DH</span>
        <p className="mt-5 text-sm font-medium text-brand">404</p>
        <h1 className="mt-1 text-xl font-semibold text-fg">This page doesn&apos;t exist</h1>
        <p className="mt-2 text-sm text-muted">The link may be outdated, or the record was archived or deleted.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/" className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-hover">
            Go to my home page
          </Link>
          <Link href="/notifications" className="inline-flex h-9 items-center rounded-lg border border-line-strong px-4 text-sm font-medium text-fg hover:bg-surface-2">
            Notifications
          </Link>
        </div>
      </div>
    </div>
  );
}
