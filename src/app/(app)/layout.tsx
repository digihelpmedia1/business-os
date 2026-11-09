import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAvailableCurrencies, getDisplayCurrency } from "@/lib/settings";
import { AppShell } from "@/components/layout/app-shell";
import { runScheduledJobsIfStale } from "@/lib/jobs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [unread, currency, currencies] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    getDisplayCurrency(),
    getAvailableCurrencies(),
  ]);
  // Keep reminders & recurring invoices fresh even without a cron (throttled to once per hour).
  after(() => runScheduledJobsIfStale().catch((e) => console.error("[jobs]", e)));
  return (
    <AppShell
      user={{ name: user.name, email: user.email, roleName: user.roleName, access: user.access, hasEmployee: !!user.employeeId }}
      unread={unread}
      currency={currency.code}
      currencies={currencies}
    >
      {children}
    </AppShell>
  );
}
