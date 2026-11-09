import Link from "next/link";
import { AlertTriangle, Bell, CheckCheck, Info, RefreshCw, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { param, withParams, type SearchParams } from "@/lib/list";
import { fmtDateTime } from "@/lib/dates";
import { NOTIFICATION_TYPES } from "@/lib/jobs";
import { Card, CardBody, CardHeader, EmptyState, PageHeader, Notice } from "@/components/ui/primitives";
import { LinkTabs } from "@/components/ui/data-table";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { InlineForm, SubmitButton } from "@/components/ui/form-dialog";
import { clearRead, markAllRead, markRead, refreshNotifications, savePreferences } from "@/server/actions/notifications";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = param(sp, "tab") === "settings" ? "settings" : "inbox";
  const filter = param(sp, "filter") ?? "unread";
  const header = (
    <PageHeader
      title="Notifications"
      description="Reminders for due invoices, renewals, deadlines, payments and more — based on your access and preferences."
      actions={tab === "inbox" ? (
        <>
          <ConfirmAction action={refreshNotifications} label={<><RefreshCw /> Check now</>} noConfirm variant="outline" size="md" />
          <ConfirmAction action={markAllRead} label={<><CheckCheck /> Mark all read</>} noConfirm variant="outline" size="md" />
        </>
      ) : null}
    />
  );
  const tabs = <LinkTabs active={tab} tabs={[{ key: "inbox", label: "Inbox", href: "/notifications" }, { key: "settings", label: "Preferences", href: "/notifications?tab=settings" }]} />;

  if (tab === "settings") {
    const prefs = await db.notificationPreference.findMany({ where: { userId: user.id } });
    const visible = NOTIFICATION_TYPES.filter((t) => can(user.access, t.module) || (t.type === "TASK_DEADLINE" && !!user.employeeId));
    return (
      <>
        {header}
        {tabs}
        <Notice className="mb-4">Email and WhatsApp delivery are prepared in the data model but not yet connected — choices are saved now and will apply once an email/WhatsApp provider is configured. In-app reminders work today.</Notice>
        <Card>
          <InlineForm action={savePreferences} successMessage="Preferences saved">
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-line bg-surface-2 text-xs text-muted"><th className="px-4 py-2.5 text-left">Reminder</th><th className="px-4 py-2.5">In-app</th><th className="px-4 py-2.5">Email <span className="font-normal">(soon)</span></th><th className="px-4 py-2.5">WhatsApp <span className="font-normal">(soon)</span></th><th className="px-4 py-2.5">Days before</th></tr></thead>
                <tbody>
                  {visible.map((t) => {
                    const p = prefs.find((x) => x.type === t.type);
                    return (
                      <tr key={t.type} className="border-b border-line last:border-0">
                        <td className="px-4 py-3"><p className="font-medium">{t.label}</p><p className="text-xs text-muted">{t.help}</p></td>
                        <td className="px-4 py-3 text-center"><input type="checkbox" name={`inApp_${t.type}`} defaultChecked={p?.inApp ?? true} className="h-4 w-4 accent-[var(--brand)]" aria-label={`${t.label} in-app`} /></td>
                        <td className="px-4 py-3 text-center"><input type="checkbox" name={`email_${t.type}`} defaultChecked={p?.email ?? false} className="h-4 w-4 accent-[var(--brand)]" aria-label={`${t.label} email`} /></td>
                        <td className="px-4 py-3 text-center"><input type="checkbox" name={`wa_${t.type}`} defaultChecked={p?.whatsapp ?? false} className="h-4 w-4 accent-[var(--brand)]" aria-label={`${t.label} WhatsApp`} /></td>
                        <td className="px-4 py-3 text-center"><input type="number" min={0} max={120} name={`lead_${t.type}`} defaultValue={p?.leadDays ?? t.defaultLead} className="h-8 w-20 rounded-lg border border-line-strong bg-surface px-2 text-center" aria-label={`${t.label} days before`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <CardBody className="flex justify-end border-t border-line py-3"><SubmitButton>Save preferences</SubmitButton></CardBody>
          </InlineForm>
        </Card>
      </>
    );
  }

  const items = await db.notification.findMany({
    where: { userId: user.id, ...(filter === "unread" ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      {header}
      {tabs}
      <div className="mb-4 flex items-center gap-2 text-[13px]">
        {[["unread", "Unread"], ["all", "All"]].map(([k, l]) => (
          <a key={k} href={withParams("/notifications", sp, { filter: k === "unread" ? null : k })} className={`rounded-full border px-3 py-1 ${filter === k ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}>{l}</a>
        ))}
        <span className="flex-1" />
        {filter === "all" ? <ConfirmAction action={clearRead} label={<><Trash2 /> Clear read</>} title="Delete all read notifications?" confirmLabel="Clear" variant="ghost" /> : null}
      </div>
      <Card>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((n) => (
              <li key={n.id} className={cn("flex items-start gap-3 px-5 py-3.5", !n.readAt && "bg-brand-soft/30")}>
                <span className={cn("mt-0.5", n.severity === "CRITICAL" ? "text-danger" : n.severity === "WARNING" ? "text-warning" : "text-brand")}>
                  {n.severity === "INFO" ? <Info className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  {n.link ? <Link href={n.link} className="text-sm font-medium hover:text-brand">{n.title}</Link> : <p className="text-sm font-medium">{n.title}</p>}
                  {n.body ? <p className="text-[13px] text-muted">{n.body}</p> : null}
                  <p className="mt-0.5 text-xs text-subtle">{NOTIFICATION_TYPES.find((t) => t.type === n.type)?.label ?? n.type} · {fmtDateTime(n.createdAt)}</p>
                </div>
                {!n.readAt ? <ConfirmAction action={markRead.bind(null, n.id)} label="Mark read" noConfirm variant="ghost" size="sm" /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Bell />} title={filter === "unread" ? "You're all caught up" : "No notifications yet"} description="Reminders appear here automatically (checked hourly and by the daily job)." />
        )}
      </Card>
    </>
  );
}
