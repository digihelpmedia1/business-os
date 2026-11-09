# Architecture

## Layout

```
prisma/schema.prisma        Data model (40+ models) · prisma/migrations · prisma/seed.ts (setup data, no demo data)
src/proxy.ts                Edge gate: unauthenticated requests → /login (public: /login, /share, /api/v1, /api/integrations, /api/cron, /api/health, /api/public)
src/lib/
  auth/                     JWT session (jose, HS256, HTTP-only cookie) · getCurrentUser · requirePageAccess / requireActionAccess
  permissions.ts            Modules × access levels (NONE < VIEW < EDIT < FULL) and preset roles
  money.ts · gst.ts         Decimal-safe money, INR formatting, amount in words · GST engine (CGST/SGST/IGST, rounding)
  dates.ts                  IST calendar dates, Indian financial year, period presets
  numbering.ts              Atomic gap-free FY document series (INSERT … ON CONFLICT … RETURNING inside the issuing transaction)
  finance/engine.ts         Pure accrual & cash aggregation (unit tested)
  finance/reports.ts        P&L, cash flow, balance sheet, receivables/payables ageing, project profitability
  finance/metrics.ts        BI metrics with formulas, client/service profitability, forecast
  finance/ledger.ts         Invoice/bill recalculation, account balances, derived “Overdue”
  jobs.ts                   Reminders (13 types) + recurring invoices; daily cron + hourly lazy refresh
  integrations.ts           Signed webhooks, API-key auth & scopes · crm-sync.ts client upsert
  storage.ts                Private file storage (Postgres or S3) · pdf/render.tsx PDF documents
  assistant.ts              Claude tool-use loop with read-only, access-filtered tools
src/server/services/        Domain services used by actions, jobs and API (billing)
src/server/actions/         Server actions per module — validate with Zod, check access level, write in a DB transaction, audit-log, emit webhook
src/app/(app)/…             Authenticated pages (server components) · src/app/api/… route handlers
src/components/             UI kit (cards, data table, form dialog, confirm action, toolbar), charts, layout, editors
```

## Access control

Every **page** calls `requirePageAccess(module, level)`; every **server action** calls `requireActionAccess(module, level)`; **file downloads**, **exports** and **PDFs** check the module too. Roles hold one level per module (stored in `RolePermission.level`). The system Admin role always has FULL. Sidebar items are hidden for modules at NONE. Users linked to an employee profile can always update their own tasks, log their own time and request leave. Session tokens carry `tokenVersion`; changing a password, role or active flag increments it and signs the user out everywhere.

## Accounting rules

Books are in INR. Display-currency conversion (dashboards, statements, BI) uses stored exchange rates and never changes stored values.

**Revenue (accrual):** taxable value (GST excluded) of issued GST tax invoices, non-GST invoices and debit notes **by document date**, minus credit notes, plus income transactions in a *Revenue* category that are not linked to an invoice payment. Proforma and advance invoices are not revenue; payments against them are customer advances until converted.

**No double counting:** recording an invoice payment creates exactly one INCOME transaction linked by a unique `paymentId`. Accrual reports read invoices and ignore payment-linked transactions; cash reports read transactions. The same applies to vendor bills (expensed on bill date; bill payments are cash only). Manual income cannot use the *Client Payments* category.

**Expenses:** expense transactions not linked to a bill (net of claimable input GST) + vendor bills (subtotal). Category *kind* decides placement: Cost of services → gross profit; Operating expense → operating profit; Non-operating → net profit; Capital expenditure, Tax settlement and Owner equity never hit the P&L.

**Invoice status:** DRAFT → ISSUED → PARTIALLY_PAID → PAID (or CANCELLED). Amount paid includes TDS deducted by the client. *Overdue* is derived from the due date at read time, so it can never be stale. Issued documents are immutable — adjust with credit/debit notes; cancelling requires voiding payments first and keeps the number (series stay gap-free).

**Balance sheet (management, simplified):** cash & bank, receivables, TDS receivable, input GST, fixed assets at cost | payables, output GST net of tax paid, customer advances | opening capital, owner capital/drawings, retained earnings (balancing figure). Integration tests assert that retained earnings equal accrual net profit and that the cash-flow statement reconciles opening to closing cash.

## Metric formulas

| Metric | Formula |
|---|---|
| Gross revenue | Σ taxable value of issued revenue invoices & debit notes + direct revenue |
| Net revenue | Gross revenue − credit notes |
| Gross profit | Net revenue − cost of services |
| Operating profit / margin | Gross profit − operating expenses; ÷ net revenue |
| Net profit | Operating profit + other income − non-operating expenses |
| MRR / ARR | Σ active recurring-invoice profiles (taxable) normalised to a month; × 12 |
| ARPC | Net revenue ÷ clients invoiced in the period |
| Revenue / expense growth | (current − previous equal-length period) ÷ previous |
| Net cash flow | Cash in − cash out (transfers excluded) |
| Cash runway | Cash balance ÷ average monthly net burn of the last 3 complete months (“not burning cash” if positive) |
| New clients | Clients whose acquisition date (else first invoice date) is in the period |
| CAC | Spend in categories flagged *acquisition* ÷ new clients |
| Retention / churn | Clients invoiced in both previous and current period ÷ clients invoiced in previous period; churn = 1 − retention |
| LTV | (Monthly revenue per client × gross margin) ÷ average monthly churn over the last 6 months (needs ≥ 4 months of history) |
| LTV : CAC | LTV ÷ CAC |
| Revenue per employee | Net revenue ÷ employees active in the period (freelancers excluded) |
| Concentration | Top-1 and top-5 clients' share of revenue |
| Project profit | Invoiced revenue (net of credit notes) − project expenses & bills − time cost (hours × cost rate) |
| Forecast | Ordinary least-squares trend over up to 12 complete months (needs ≥ 4), shown with R² and labelled as a forecast |

When inputs are missing a metric shows **Insufficient Data** with the reason.

## Development plan (as built)

1. Architecture & module map → 2. Schema & migrations → 3. Auth, RBAC, layout → 4. Design system & dashboard → 5. Proposals, quotations, invoices, payments, PDFs → 6. Finance & statements → 7. Projects & operations → 8. BI & reports → 9. Subscriptions, assets, settings, users & roles → 10. Vendors, team, planning, vault, notifications, AI assistant, integrations & export → 11. Unit, integration and page smoke tests → 12. Deployment documentation.

## Known limits / next steps

- Statutory payroll (PF/ESI/TDS on salary) is not computed — record net pay and deductions separately.
- E-invoicing (IRN/QR) and e-way bills are not integrated; numbering and GST fields are ready for it.
- Email/WhatsApp delivery of reminders is modelled (per-user preferences) but needs a provider connection; in-app reminders work today.
- Fixed assets are carried at cost (no depreciation schedule).
- The JSON export is for data portability; restore is done with `pg_restore` from database backups.
