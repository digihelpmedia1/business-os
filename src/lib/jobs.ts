import "server-only";
import type { NotificationType, Severity } from "@prisma/client";
import { db } from "./db";
import { addDays, addMonths, daysBetween, fmtDate, monthLongLabel, startOfMonth, todayIST, isoDate } from "./dates";
import { can, emptyAccess, MODULES, type AccessMap, type Level, type ModuleKey } from "./permissions";
import { createInvoice, issueInvoice } from "@/server/services/billing";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { D } from "./money";

export const NOTIFICATION_TYPES: { type: NotificationType; label: string; module: ModuleKey; defaultLead: number; help: string }[] = [
  { type: "INVOICE_DUE", label: "Invoice due soon", module: "billing", defaultLead: 3, help: "Days before an invoice due date" },
  { type: "INVOICE_OVERDUE", label: "Overdue invoices", module: "billing", defaultLead: 0, help: "Weekly while an invoice stays overdue" },
  { type: "RECURRING_INVOICE", label: "Recurring invoice generated", module: "billing", defaultLead: 0, help: "When a recurring invoice is created" },
  { type: "SUBSCRIPTION_RENEWAL", label: "Subscription renewals", module: "assets", defaultLead: 7, help: "Days before a subscription renews" },
  { type: "DOMAIN_RENEWAL", label: "Domain & hosting renewals", module: "assets", defaultLead: 30, help: "Days before a domain/hosting renewal" },
  { type: "WARRANTY_EXPIRY", label: "Asset warranty expiry", module: "assets", defaultLead: 30, help: "Days before a warranty ends" },
  { type: "PROJECT_DEADLINE", label: "Project deadlines", module: "projects", defaultLead: 5, help: "Days before a project end date" },
  { type: "TASK_DEADLINE", label: "Task deadlines", module: "projects", defaultLead: 1, help: "Days before a task is due" },
  { type: "CONTRACT_EXPIRY", label: "Contract / agreement expiry", module: "vault", defaultLead: 30, help: "Days before a vault document expires" },
  { type: "VENDOR_PAYMENT", label: "Vendor payments due", module: "vendors", defaultLead: 3, help: "Days before a purchase bill is due" },
  { type: "EMPLOYEE_PAYMENT", label: "Salary & payouts", module: "team", defaultLead: 2, help: "Days before the monthly salary pay day" },
  { type: "MONTHLY_CLOSING", label: "Monthly financial closing", module: "finance", defaultLead: 0, help: "First working days of each month" },
  { type: "GOAL_PERIOD", label: "Goal period ending", module: "planning", defaultLead: 7, help: "Days before a goal's period ends" },
];

type Candidate = {
  type: NotificationType;
  severity: Severity;
  title: string;
  body?: string;
  link: string;
  dedupeKey: string;
  daysUntil: number; // negative = past
  onlyUserIds?: string[];
};

async function usersWithAccess() {
  const users = await db.user.findMany({
    where: { isActive: true },
    include: { role: { include: { permissions: { include: { permission: true } } } }, notificationPrefs: true },
  });
  return users.map((u) => {
    const access: AccessMap = emptyAccess();
    if (u.role.isSystem && u.role.name === "Admin") Object.assign(access, emptyAccess("FULL"));
    else for (const rp of u.role.permissions) if (MODULES.some((m) => m.key === rp.permission.key)) access[rp.permission.key as ModuleKey] = rp.level as Level;
    return { id: u.id, access, prefs: u.notificationPrefs };
  });
}

export async function generateNotifications(today: Date = todayIST()) {
  const settings = await getSettings();
  const horizon = addDays(today, 60);
  const c: Candidate[] = [];
  const week = Math.floor(today.getTime() / (7 * 86_400_000));

  const [invoices, subs, assets, projects, tasks, docs, bills, goals] = await Promise.all([
    db.invoice.findMany({
      where: { deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, type: { not: "CREDIT_NOTE" }, dueDate: { not: null, lte: horizon } },
      select: { id: true, number: true, dueDate: true, total: true, amountPaid: true, amountCredited: true, clientName: true },
    }),
    db.subscription.findMany({ where: { deletedAt: null, status: "ACTIVE", renewalDate: { lte: horizon } } }),
    db.asset.findMany({ where: { deletedAt: null, status: { in: ["IN_USE", "IN_STOCK"] }, warrantyUntil: { gte: today, lte: horizon } } }),
    db.project.findMany({ where: { deletedAt: null, status: { in: ["PLANNING", "NOT_STARTED", "IN_PROGRESS"] }, endDate: { not: null, lte: horizon } } }),
    db.task.findMany({
      where: { deletedAt: null, status: { not: "DONE" }, dueDate: { not: null, lte: addDays(today, 14) } },
      include: { project: { select: { name: true } }, assignee: { select: { userId: true } } },
    }),
    db.document.findMany({ where: { deletedAt: null, expiresAt: { not: null, lte: horizon } } }),
    db.vendorBill.findMany({ where: { deletedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] }, dueDate: { not: null, lte: horizon } }, include: { vendor: true } }),
    db.financialGoal.findMany({ where: { periodEnd: { gte: today, lte: addDays(today, 31) } } }),
  ]);

  for (const inv of invoices) {
    const due = inv.dueDate!;
    const d = daysBetween(today, due);
    const outstanding = D(inv.total).minus(D(inv.amountPaid)).minus(D(inv.amountCredited));
    if (outstanding.lte(0)) continue;
    if (d < 0)
      c.push({
        type: "INVOICE_OVERDUE", severity: d < -30 ? "CRITICAL" : "WARNING",
        title: `${inv.number} is ${-d} day(s) overdue`,
        body: `${inv.clientName} owes ₹${outstanding.toFixed(2)} (due ${fmtDate(due)}).`,
        link: `/billing/invoices/${inv.id}`, dedupeKey: `inv-overdue:${inv.id}:${week}`, daysUntil: 0,
      });
    else
      c.push({
        type: "INVOICE_DUE", severity: "INFO",
        title: `${inv.number} is due ${d === 0 ? "today" : `in ${d} day(s)`}`,
        body: `${inv.clientName} — ₹${outstanding.toFixed(2)} outstanding.`,
        link: `/billing/invoices/${inv.id}`, dedupeKey: `inv-due:${inv.id}:${isoDate(due)}`, daysUntil: d,
      });
  }
  for (const s of subs) {
    const d = daysBetween(today, s.renewalDate);
    const isDomain = s.kind === "DOMAIN" || s.kind === "HOSTING";
    c.push({
      type: isDomain ? "DOMAIN_RENEWAL" : "SUBSCRIPTION_RENEWAL",
      severity: d < 0 ? "CRITICAL" : d <= 3 ? "WARNING" : "INFO",
      title: d < 0 ? `${s.name} renewal date has passed` : `${s.name} renews ${d === 0 ? "today" : `in ${d} day(s)`}`,
      body: `${s.domainName ? s.domainName + " · " : ""}₹${s.cost.toFixed(2)} ${s.billingCycle.toLowerCase().replace("_", "-")}${s.autoRenew ? " · auto-renew on" : " · auto-renew OFF"}`,
      link: `/subscriptions?q=${encodeURIComponent(s.name)}`, dedupeKey: `sub:${s.id}:${isoDate(s.renewalDate)}`, daysUntil: Math.max(d, 0),
    });
  }
  for (const a of assets) {
    const d = daysBetween(today, a.warrantyUntil!);
    c.push({ type: "WARRANTY_EXPIRY", severity: "INFO", title: `Warranty for ${a.name} ends in ${d} day(s)`, link: `/assets/${a.id}`, dedupeKey: `warranty:${a.id}:${isoDate(a.warrantyUntil)}`, daysUntil: d });
  }
  for (const p of projects) {
    const d = daysBetween(today, p.endDate!);
    c.push({
      type: "PROJECT_DEADLINE", severity: d < 0 ? "WARNING" : "INFO",
      title: d < 0 ? `Project “${p.name}” is past its end date` : `Project “${p.name}” ends ${d === 0 ? "today" : `in ${d} day(s)`}`,
      link: `/projects/${p.id}`, dedupeKey: `project:${p.id}:${isoDate(p.endDate)}${d < 0 ? `:${week}` : ""}`, daysUntil: Math.max(d, 0),
    });
  }
  for (const t of tasks) {
    const d = daysBetween(today, t.dueDate!);
    c.push({
      type: "TASK_DEADLINE", severity: d < 0 ? "WARNING" : "INFO",
      title: d < 0 ? `Task overdue: ${t.title}` : `Task due ${d === 0 ? "today" : `in ${d} day(s)`}: ${t.title}`,
      body: t.project.name, link: `/projects/${t.projectId}?tab=tasks`,
      dedupeKey: `task:${t.id}:${isoDate(t.dueDate)}${d < 0 ? ":late" : ""}`, daysUntil: Math.max(d, 0),
      onlyUserIds: t.assignee?.userId ? [t.assignee.userId] : undefined,
    });
  }
  for (const doc of docs) {
    const d = daysBetween(today, doc.expiresAt!);
    c.push({ type: "CONTRACT_EXPIRY", severity: d < 0 ? "WARNING" : "INFO", title: d < 0 ? `“${doc.title}” has expired` : `“${doc.title}” expires in ${d} day(s)`, link: `/vault?q=${encodeURIComponent(doc.title)}`, dedupeKey: `doc:${doc.id}:${isoDate(doc.expiresAt)}`, daysUntil: Math.max(d, 0) });
  }
  for (const b of bills) {
    const d = daysBetween(today, b.dueDate!);
    const outstanding = D(b.total).minus(D(b.amountPaid));
    c.push({
      type: "VENDOR_PAYMENT", severity: d < 0 ? "WARNING" : "INFO",
      title: d < 0 ? `Vendor bill ${b.billNumber} (${b.vendor.name}) is overdue` : `Pay ${b.vendor.name} ₹${outstanding.toFixed(2)} ${d === 0 ? "today" : `in ${d} day(s)`}`,
      link: `/vendors/bills?q=${encodeURIComponent(b.billNumber)}`, dedupeKey: `bill:${b.id}:${isoDate(b.dueDate)}${d < 0 ? `:${week}` : ""}`, daysUntil: Math.max(d, 0),
    });
  }
  // Salary pay day for the current month.
  const activeSalaried = await db.employee.count({ where: { deletedAt: null, status: { not: "EXITED" }, compensationType: "MONTHLY_SALARY" } });
  if (activeSalaried > 0) {
    const payDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), Math.min(settings.salaryPayDay, 28)));
    const d = daysBetween(today, payDay);
    if (d >= 0)
      c.push({ type: "EMPLOYEE_PAYMENT", severity: "INFO", title: `Salaries due ${d === 0 ? "today" : `in ${d} day(s)`} (${fmtDate(payDay)})`, body: `${activeSalaried} salaried team member(s).`, link: "/team/payroll", dedupeKey: `salary:${isoDate(payDay)}`, daysUntil: d });
  }
  // Monthly closing reminder during the first 5 days of a month.
  if (today.getUTCDate() <= 5) {
    const prevMonth = addMonths(startOfMonth(today), -1);
    c.push({ type: "MONTHLY_CLOSING", severity: "INFO", title: `Close the books for ${monthLongLabel(prevMonth)}`, body: "Record all expenses, reconcile bank accounts and review the P&L.", link: `/finance/statements?range=last_month`, dedupeKey: `closing:${isoDate(prevMonth)}`, daysUntil: 0 });
  }
  for (const g of goals) {
    const d = daysBetween(today, g.periodEnd);
    c.push({ type: "GOAL_PERIOD", severity: "INFO", title: `Goal “${g.title}” period ends in ${d} day(s)`, link: "/planning", dedupeKey: `goal:${g.id}:${isoDate(g.periodEnd)}`, daysUntil: d });
  }

  const users = await usersWithAccess();
  const rows: { userId: string; type: NotificationType; severity: Severity; title: string; body: string | null; link: string; dedupeKey: string }[] = [];
  for (const cand of c) {
    const meta = NOTIFICATION_TYPES.find((n) => n.type === cand.type)!;
    for (const u of users) {
      if (cand.onlyUserIds ? !cand.onlyUserIds.includes(u.id) && !can(u.access, meta.module, "EDIT") : !can(u.access, meta.module, "VIEW")) continue;
      const pref = u.prefs.find((p) => p.type === cand.type);
      if (pref && !pref.inApp) continue;
      const lead = pref?.leadDays ?? meta.defaultLead;
      if (cand.daysUntil > lead) continue;
      rows.push({ userId: u.id, type: cand.type, severity: cand.severity, title: cand.title.slice(0, 200), body: cand.body ?? null, link: cand.link, dedupeKey: cand.dedupeKey });
    }
  }
  if (rows.length) await db.notification.createMany({ data: rows, skipDuplicates: true });
  return { candidates: c.length, created: rows.length };
}

function advance(date: Date, freq: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY") {
  return addMonths(date, { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 }[freq]);
}

/** Generate invoices for recurring profiles that are due (catches up missed runs). */
export async function runRecurringInvoices(today: Date = todayIST()) {
  const profiles = await db.recurringInvoice.findMany({ where: { isActive: true, nextRunDate: { lte: today } }, include: { client: true } });
  const results: { profile: string; invoiceId: string }[] = [];
  for (const p of profiles) {
    let runDate = p.nextRunDate;
    let guard = 0;
    while (runDate <= today && (!p.endDate || runDate <= p.endDate) && guard++ < 12) {
      const rd = runDate;
      try {
        const invoice = await db.$transaction(async (tx) => {
          const inv = await createInvoice(
            tx,
            {
              type: p.invoiceType,
              clientId: p.clientId,
              projectId: p.projectId,
              relatedInvoiceId: null,
              issueDate: isoDate(rd),
              dueDate: isoDate(addDays(rd, p.dueInDays)),
              placeOfSupply: null,
              periodLabel: monthLongLabel(rd),
              reverseCharge: false,
              paymentTerms: `Payable within ${p.dueInDays} days.`,
              notes: p.notes,
              terms: null,
              reason: null,
              items: (p.items as Record<string, string>[]).map((it) => ({
                serviceId: it.serviceId || null,
                description: it.description ?? "Service",
                details: it.details || null,
                sacCode: it.sacCode || null,
                unit: it.unit || null,
                quantity: String(it.quantity ?? "1"),
                unitPrice: String(it.unitPrice ?? "0"),
                discountPercent: String(it.discountPercent ?? "0"),
                taxRate: String(it.taxRate ?? "0"),
              })),
            },
            null,
            { recurringProfileId: p.id },
          );
          if (p.autoIssue) await issueInvoice(tx, inv.id, null);
          await tx.recurringInvoice.update({ where: { id: p.id }, data: { nextRunDate: advance(rd, p.frequency), lastRunAt: new Date() } });
          return inv;
        });
        results.push({ profile: p.name, invoiceId: invoice.id });
        const billingUsers = (await usersWithAccess()).filter((u) => can(u.access, "billing", "EDIT"));
        await db.notification.createMany({
          data: billingUsers.map((u) => ({
            userId: u.id, type: "RECURRING_INVOICE" as const, severity: "INFO" as const,
            title: `${p.autoIssue ? "Issued" : "Draft created"}: recurring invoice for ${p.client.name}`,
            body: `${p.name} · ${monthLongLabel(rd)}`, link: `/billing/invoices/${invoice.id}`, dedupeKey: `recurring:${p.id}:${isoDate(rd)}`,
          })),
          skipDuplicates: true,
        });
      } catch (e) {
        console.error(`[recurring] profile ${p.id} failed`, e);
        await audit({ action: "ERROR", entityType: "RecurringInvoice", entityId: p.id, summary: `Recurring invoice generation failed: ${(e as Error).message}` });
        break;
      }
      runDate = advance(rd, p.frequency);
    }
  }
  // Auto-expire quotes past their expiry date that were sent but not answered.
  await db.quote.updateMany({ where: { status: "SENT", expiryDate: { lt: today }, convertedInvoiceId: null }, data: { status: "EXPIRED" } });
  return results;
}

export async function runScheduledJobs() {
  const recurring = await runRecurringInvoices();
  const notifications = await generateNotifications();
  await db.appMeta.upsert({ where: { key: "jobs.lastRun" }, create: { key: "jobs.lastRun", value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  return { recurring: recurring.length, notifications };
}

export async function runScheduledJobsIfStale(maxAgeMinutes = 60) {
  const meta = await db.appMeta.findUnique({ where: { key: "jobs.lastRun" } });
  if (meta && Date.now() - new Date(meta.value).getTime() < maxAgeMinutes * 60_000) return null;
  // Claim the run first so concurrent requests don't duplicate work.
  await db.appMeta.upsert({ where: { key: "jobs.lastRun" }, create: { key: "jobs.lastRun", value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  return runScheduledJobs();
}
