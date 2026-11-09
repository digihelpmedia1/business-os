"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { CURRENCY_COOKIE } from "@/lib/settings";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";

export async function setDisplayCurrency(code: string) {
  const user = await getCurrentUser();
  if (!user) return;
  const store = await cookies();
  const valid = code === "INR" || (await db.exchangeRate.findUnique({ where: { currency: code } }));
  store.set(CURRENCY_COOKIE, valid ? code : "INR", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
}

export async function logout() {
  const user = await getCurrentUser();
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  if (user) await audit({ userId: user.id, action: "LOGOUT", entityType: "User", entityId: user.id, summary: `${user.email} signed out` });
  redirect("/login");
}

export type SearchResult = { type: string; label: string; sub?: string; href: string };

export async function globalSearch(q: string): Promise<SearchResult[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const term = q.trim();
  if (term.length < 2) return [];
  const ci = { contains: term, mode: "insensitive" as const };
  const out: SearchResult[] = [];
  const tasks: Promise<void>[] = [];
  if (can(user.access, "billing")) {
    tasks.push(
      db.client
        .findMany({ where: { deletedAt: null, OR: [{ name: ci }, { businessName: ci }, { email: ci }, { phone: ci }, { gstin: ci }] }, take: 5 })
        .then((r) => r.forEach((c) => out.push({ type: "Client", label: c.name, sub: c.businessName ?? c.email ?? undefined, href: `/billing/clients/${c.id}` }))),
      db.invoice
        .findMany({ where: { deletedAt: null, OR: [{ number: ci }, { client: { name: ci } }] }, include: { client: true }, take: 5, orderBy: { issueDate: "desc" } })
        .then((r) => r.forEach((i) => out.push({ type: "Invoice", label: i.number ?? "Draft invoice", sub: i.client.name, href: `/billing/invoices/${i.id}` }))),
      db.quote
        .findMany({ where: { deletedAt: null, OR: [{ number: ci }, { title: ci }, { client: { name: ci } }] }, include: { client: true }, take: 5, orderBy: { issueDate: "desc" } })
        .then((r) => r.forEach((d) => out.push({ type: d.kind === "PROPOSAL" ? "Proposal" : d.kind === "ESTIMATE" ? "Estimate" : "Quotation", label: `${d.number} — ${d.title}`, sub: d.client.name, href: `/billing/quotes/${d.id}` }))),
    );
  }
  if (can(user.access, "projects")) {
    tasks.push(
      db.project
        .findMany({ where: { deletedAt: null, OR: [{ name: ci }, { code: ci }] }, include: { client: true }, take: 5 })
        .then((r) => r.forEach((p) => out.push({ type: "Project", label: p.name, sub: p.client?.name, href: `/projects/${p.id}` }))),
      db.task
        .findMany({ where: { deletedAt: null, title: ci }, include: { project: true }, take: 5 })
        .then((r) => r.forEach((t) => out.push({ type: "Task", label: t.title, sub: t.project.name, href: `/projects/${t.projectId}?tab=tasks` }))),
    );
  }
  if (can(user.access, "vendors")) {
    tasks.push(
      db.vendor
        .findMany({ where: { deletedAt: null, OR: [{ name: ci }, { gstin: ci }, { email: ci }] }, take: 5 })
        .then((r) => r.forEach((v) => out.push({ type: "Vendor", label: v.name, sub: v.category ?? undefined, href: `/vendors/${v.id}` }))),
    );
  }
  if (can(user.access, "finance")) {
    tasks.push(
      db.transaction
        .findMany({ where: { deletedAt: null, OR: [{ description: ci }, { reference: ci }] }, take: 5, orderBy: { date: "desc" } })
        .then((r) => r.forEach((t) => out.push({ type: "Transaction", label: t.description, sub: `${t.type.toLowerCase()} · ₹${t.amount.toFixed(2)}`, href: `/finance/transactions?q=${encodeURIComponent(t.description)}` }))),
    );
  }
  if (can(user.access, "team")) {
    tasks.push(
      db.employee
        .findMany({ where: { deletedAt: null, OR: [{ name: ci }, { email: ci }, { designation: ci }] }, take: 5 })
        .then((r) => r.forEach((e) => out.push({ type: e.type === "FREELANCER" ? "Freelancer" : "Employee", label: e.name, sub: e.designation ?? undefined, href: `/team/${e.id}` }))),
    );
  }
  if (can(user.access, "vault")) {
    tasks.push(
      db.document
        .findMany({ where: { deletedAt: null, OR: [{ title: ci }, { description: ci }] }, take: 5 })
        .then((r) => r.forEach((d) => out.push({ type: "Document", label: d.title, sub: d.category.replace(/_/g, " ").toLowerCase(), href: `/vault?q=${encodeURIComponent(d.title)}` }))),
    );
  }
  if (can(user.access, "assets")) {
    tasks.push(
      db.subscription
        .findMany({ where: { deletedAt: null, OR: [{ name: ci }, { provider: ci }, { domainName: ci }] }, take: 5 })
        .then((r) => r.forEach((s) => out.push({ type: "Subscription", label: s.name, sub: s.provider ?? undefined, href: `/subscriptions?q=${encodeURIComponent(s.name)}` }))),
    );
  }
  await Promise.all(tasks);
  return out.slice(0, 30);
}
