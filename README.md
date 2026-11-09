# DHM Business OS

**One Platform. Complete Business Control.**

Internal business management & intelligence platform for **Digi Help Media** — billing, finance, projects, people, assets, planning and business intelligence in one secure web app. It deliberately does **not** duplicate the existing lead CRM; clients arrive from the CRM through the integration API (or are added manually).

| | |
|---|---|
| Stack | Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 6 · PostgreSQL · Zod 4 · Recharts · @react-pdf/renderer · jose (JWT) · bcrypt |
| Locale | INR (₹, Indian digit grouping) · Asia/Kolkata · Financial year April–March (configurable) |
| Hosting | Vercel (app + daily cron) + any PostgreSQL (Supabase / Neon / Vercel Postgres) |

## Modules

| Area | What it does |
|---|---|
| **Overview Dashboard** | 8 financial KPIs (revenue, monthly revenue, MRR, expenses, net profit, receivables, payables, cash) + 6 operational KPIs, 6 charts, alerts, overdue invoices, upcoming payments & deadlines, recent transactions & documents. Period filter: this/last month, last 3/6 months, this/previous FY, custom. Every number comes from the database. |
| **Documents & Billing** | Clients (CRM-linked or manual) · Proposals, quotations & estimates with 7 templates, versions, statuses, duplicate, branded PDF, print, public share link, convert-to-invoice · GST tax invoices, non-GST, proforma, advance, credit & debit notes · CGST/SGST vs IGST by place of supply · gap-free FY numbering · partial payments with TDS · receipts · recurring invoices (auto draft/issue) · payment reminders |
| **Finance & Accounting** | Bank/cash accounts with computed balances · income, expense & transfer transactions with attachments · categories with statement treatment · P&L, cash flow, balance sheet, receivables & payables ageing, monthly summary · CSV exports |
| **Projects & Operations** | Projects (fixed / retainer / hourly) · tasks & subtasks · Kanban drag-and-drop · calendar · milestones & deliverables · time tracking with cost rates · internal notes · project profitability · monthly retainer roll-over |
| **Business Intelligence** | 25+ metrics each with its formula (revenue, margins, MRR/ARR, ARPC, growth, runway, CAC, LTV, LTV:CAC, retention, churn, revenue per employee, concentration) · client / service / project profitability · MoM, YoY, QoQ, FY comparisons · labelled linear forecast · “Insufficient Data” instead of invented numbers |
| **Expenses & Vendors** | Vendor database with duplicate prevention (normalised name + GSTIN) · purchase bills with input GST · bill payments · vendor-wise spend |
| **Subscriptions & Assets** | Software / AI / hosting / domain subscriptions with renewal reminders and one-click renewal payment · asset register with assignment, warranty and maintenance log |
| **Planning & Goals** | Revenue, cash, profit, expense-cap, service-revenue, new-client, retention, MRR and custom goals per month/quarter/FY with progress vs time elapsed · category budgets vs actual |
| **Employee Management** | Employees & freelancers · salary records · attendance register · leave requests & approvals · payroll & payouts (posted to finance) · workload |
| **Reports & Analytics** | GST summary · 20+ CSV reports |
| **Document Vault** | Private file storage (PostgreSQL or S3-compatible), categories, links to clients/projects/vendors/employees, expiry reminders, download log |
| **Notifications** | 13 reminder types (due/overdue invoices, renewals, domains, deadlines, contracts, vendor & salary payments, month-end close, goals…) with per-user preferences |
| **AI Assistant** | Optional Claude-powered analyst with read-only tools scoped to the user's access; separates facts, forecasts and recommendations; cannot modify records |
| **Settings** | Company & GST, logo & brand colours, bank details, numbering, tax rates, services catalog, templates, currencies (display conversion, ECB rates), users, **roles with per-module access levels (None / View / Edit / Full)**, audit log, integrations, data export |
| **Integrations** | REST API with scoped API keys · CRM webhook endpoint (converted leads → clients, no duplicates) · signed outgoing webhooks for n8n / Zapier / Make / any app |

## Quick start (local)

```bash
npm install
cp .env.example .env          # set AUTH_SECRET (48+ random chars) and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
npm run db:local              # optional: starts a real PostgreSQL on :54329 without installing anything (keep it running)
npx prisma migrate deploy     # create tables
npm run db:seed               # roles, categories, services, templates, numbering, first admin
npm run dev                   # http://localhost:3000
```

## Testing

```bash
npm run typecheck
npm test                                             # unit tests (GST, money, dates, revenue recognition)
TEST_DATABASE_URL=postgresql://…/dhm_test npm test   # + integration tests (billing flow, all server actions, API) — wipes that DB
node scripts/smoke.mjs http://localhost:3000         # renders every page, PDF, export and API route as a signed-in admin
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map, data model, accounting rules, metric formulas, security
- [DEPLOYMENT.md](DEPLOYMENT.md) — Vercel + PostgreSQL deployment, environment variables, backups
- [docs/API.md](docs/API.md) — REST API, CRM webhook and outgoing webhooks

## Security notes

Passwords are bcrypt-hashed (cost 12); sessions are signed HTTP-only cookies invalidated on password/role change; 5 failed sign-ins lock an account for 15 minutes; every page, server action, file download and API call checks the user's module access level server-side; all financial changes are audit-logged; secrets live only in environment variables.
