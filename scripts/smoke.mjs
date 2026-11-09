// Smoke test: requests every app page as a signed-in user and reports failures.
//   node scripts/smoke.mjs [baseUrl] [email]
// Reads AUTH_SECRET and DATABASE_URL from .env. Intended for local verification.
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
process.env.DATABASE_URL ??= env.DATABASE_URL;
process.env.DIRECT_URL ??= env.DIRECT_URL;

const base = process.argv[2] || "http://localhost:3000";
const email = process.argv[3];
const db = new PrismaClient();
const user = email ? await db.user.findUnique({ where: { email } }) : await db.user.findFirst({ orderBy: { createdAt: "asc" } });
if (!user) throw new Error("No user found");

const token = await new SignJWT({ tv: user.tokenVersion })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(user.id)
  .setIssuedAt()
  .setExpirationTime("1h")
  .setIssuer("dhm-business-os")
  .sign(new TextEncoder().encode(env.AUTH_SECRET));

const ids = async (model, where = {}) => (await db[model].findMany({ where, select: { id: true }, take: 2 })).map((r) => r.id);
const dynamic = [
  ...(await ids("client")).map((id) => `/billing/clients/${id}`),
  ...(await ids("quote")).flatMap((id) => [`/billing/quotes/${id}`, `/billing/quotes/${id}/edit`, `/api/pdf/quote/${id}`]),
  ...(await ids("invoice")).flatMap((id) => [`/billing/invoices/${id}`, `/api/pdf/invoice/${id}`]),
  ...(await ids("payment")).map((id) => `/api/pdf/receipt/${id}`),
  ...(await ids("project")).flatMap((id) => [`/projects/${id}`, `/projects/${id}?tab=tasks`, `/projects/${id}?tab=finance`, `/projects/${id}?tab=time`]),
  ...(await ids("vendor")).map((id) => `/vendors/${id}`),
  ...(await ids("employee")).map((id) => `/team/${id}`),
  ...(await ids("asset")).map((id) => `/assets/${id}`),
  ...(await ids("recurringInvoice")).map((id) => `/billing/recurring/${id}`),
  ...(await ids("invoice", { status: "DRAFT" })).map((id) => `/billing/invoices/${id}/edit`),
];

const pages = (process.argv[4] ? process.argv[4].split(",") : [
  "/", "/dashboard", "/dashboard?range=this_fy", "/dashboard?range=last_6_months", "/my-work", "/profile",
  "/billing/clients", "/billing/quotes", "/billing/quotes/new", "/billing/quotes/new?kind=QUOTATION", "/billing/invoices", "/billing/invoices?status=OVERDUE",
  "/billing/invoices/new", "/billing/invoices/new?type=CREDIT_NOTE", "/billing/payments", "/billing/recurring",
  "/finance/transactions", "/finance/accounts", "/finance/categories",
  "/finance/statements", "/finance/statements?tab=cashflow", "/finance/statements?tab=balance", "/finance/statements?tab=receivables",
  "/finance/statements?tab=payables", "/finance/statements?tab=monthly",
  "/projects", "/projects?view=kanban", "/projects/tasks", "/projects/calendar", "/projects/time",
  "/intelligence", "/intelligence?tab=profitability", "/intelligence?tab=projects", "/intelligence?tab=comparisons", "/intelligence?tab=forecast",
  "/vendors", "/vendors/bills", "/subscriptions", "/assets", "/planning",
  "/team", "/team/attendance", "/team/leave", "/team/payroll", "/reports", "/vault", "/assistant", "/notifications",
  "/settings", "/settings/numbering", "/settings/taxes", "/settings/services", "/settings/templates", "/settings/currencies",
  "/settings/integrations", "/settings/backup", "/settings/users", "/settings/roles", "/settings/audit", "/no-access",
  "/api/export/pnl?range=this_fy", "/api/backup", "/api/health", "/api/v1/clients", "/billing/recurring/new", "/share/quote/test-share-token-abcdefghijklmnop", "/share/quote/test-share-token-abcdefghijklmnop/pdf", "/api/export/metrics?range=this_fy", "/api/export/project-profitability", "/api/export/bills", "/api/export/time?range=this_fy", "/api/export/transactions", "/api/export/invoices", "/api/export/receivables",
]).concat(process.argv[4] ? [] : dynamic);

let failures = 0;
for (const p of pages) {
  const started = Date.now();
  try {
    const res = await fetch(base + p, { headers: { cookie: `dhm_session=${token}` }, redirect: "manual" });
    const body = res.headers.get("content-type")?.includes("text/html") ? await res.text() : "";
    const errorMarker = /Application error|Unhandled Runtime Error|Internal Server Error|__next_error__/.test(body);
    const expected = p.startsWith("/api/v1/") ? 401 : null;
    const ok = expected ? res.status === expected : (res.status >= 300 && res.status < 400) || (res.status === 200 && !errorMarker);
    if (!ok) failures++;
    console.log(`${ok ? "OK  " : "FAIL"} ${res.status} ${String(Date.now() - started).padStart(5)}ms ${p}${res.status >= 300 && res.status < 400 ? " → " + res.headers.get("location") : ""}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ERR ${p} ${e.message}`);
  }
}
await db.$disconnect();
console.log(failures ? `\n${failures} failure(s)` : "\nAll pages OK");
process.exit(failures ? 1 : 0);
