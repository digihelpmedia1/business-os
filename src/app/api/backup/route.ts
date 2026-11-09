import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { isoDate, todayIST } from "@/lib/dates";

export const runtime = "nodejs";
export const maxDuration = 60;

// Full data export as JSON (every table). Secrets are excluded: password hashes,
// API-key hashes, webhook secrets and raw file bytes (files are listed with metadata).
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can(user.access, "settings", "FULL")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [
    settings, series, counters, taxRates, services, roles, permissions, rolePermissions, users, clients, quotes, quoteItems, templates, invoices, invoiceItems,
    recurring, payments, accounts, categories, transactions, vendors, bills, projects, notes, milestones, deliverables, tasks, timeEntries, subscriptions,
    assets, maintenance, employees, salaryRecords, attendance, leaves, budgets, goals, documents, files, exchangeRates, webhooks, auditLogs,
  ] = await Promise.all([
    db.companySettings.findMany(), db.documentSeries.findMany(), db.seriesCounter.findMany(), db.taxRate.findMany(), db.service.findMany(), db.role.findMany(),
    db.permission.findMany(), db.rolePermission.findMany(),
    db.user.findMany({ select: { id: true, name: true, email: true, roleId: true, isActive: true, lastLoginAt: true, createdAt: true } }),
    db.client.findMany(), db.quote.findMany(), db.quoteItem.findMany(), db.documentTemplate.findMany(), db.invoice.findMany(), db.invoiceItem.findMany(),
    db.recurringInvoice.findMany(), db.payment.findMany(), db.account.findMany(), db.category.findMany(), db.transaction.findMany(), db.vendor.findMany(),
    db.vendorBill.findMany(), db.project.findMany(), db.projectNote.findMany(), db.milestone.findMany(), db.deliverable.findMany(), db.task.findMany(),
    db.timeEntry.findMany(), db.subscription.findMany(), db.asset.findMany(), db.assetMaintenance.findMany(), db.employee.findMany(), db.salaryRecord.findMany(),
    db.attendance.findMany(), db.leaveRecord.findMany(), db.budget.findMany(), db.financialGoal.findMany(), db.document.findMany(),
    db.storedFile.findMany({ select: { id: true, driver: true, key: true, fileName: true, mimeType: true, size: true, sha256: true, createdAt: true } }),
    db.exchangeRate.findMany(),
    db.webhook.findMany({ select: { id: true, name: true, url: true, events: true, isActive: true, createdAt: true } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20000 }),
  ]);
  const backup = {
    format: "dhm-business-os-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: user.email,
    note: "Monetary values are strings in INR. Password hashes, API keys, webhook secrets and file contents are excluded.",
    data: {
      settings, series, counters, taxRates, services, roles, permissions, rolePermissions, users, clients, quotes, quoteItems, templates, invoices, invoiceItems,
      recurring, payments, accounts, categories, transactions, vendors, bills, projects, notes, milestones, deliverables, tasks, timeEntries, subscriptions,
      assets, maintenance, employees, salaryRecords, attendance, leaves, budgets, goals, documents, files, exchangeRates, webhooks, auditLogs,
    },
  };
  await audit({ userId: user.id, action: "EXPORT", entityType: "Backup", summary: "Full JSON data export downloaded" });
  const body = JSON.stringify(backup, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dhm-business-os-backup-${isoDate(todayIST())}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
