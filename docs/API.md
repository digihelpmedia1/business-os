# Integrations

Create API keys and webhooks in **Settings → Integrations & API** (requires Full access to Settings).

## REST API

Base URL: `https://<your-app>/api/v1` · Auth header: `Authorization: Bearer dhm_…` (or `X-API-Key`). Keys are scoped; a missing scope returns `403`.

| Method & path | Scope | Notes |
|---|---|---|
| `GET /clients` | `clients:read` | |
| `POST /clients` | `clients:write` | Create or update by `externalId` (also accepts `id` / `client_id`). Body may be an object or an array (≤ 100). Matches existing clients by CRM id, then email/phone — never duplicates. |
| `GET /quotes` | `quotes:read` | Includes line items |
| `GET /invoices` | `invoices:read` | `?status=ISSUED\|PARTIALLY_PAID\|PAID…` |
| `GET /payments` | `payments:read` | |
| `GET /transactions` | `transactions:read` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `GET /projects`, `GET /tasks` | `projects:read`, `tasks:read` | `tasks?projectId=…` |
| `GET /vendors`, `GET /bills` | `vendors:read` | |
| `GET /subscriptions` | `subscriptions:read` | |
| `GET /summary` | `reports:read` | `?period=this_month\|last_month\|this_fy…` → revenue, expenses, net profit, cash received, receivables, MRR |

List endpoints: `?limit=1..200` (default 50), `?offset=`, `?updatedSince=<ISO date-time>` for incremental sync. Response: `{ data: [...], pagination: { limit, offset, returned, nextOffset } }`. Money values are strings in INR.

Client fields accepted by `POST /clients`: `externalId`, `name`/`full_name`, `businessName`/`company`, `email`, `phone`/`phone_number`, `gstin`, `city`, `services`, `campaign_name`, `platform`, `notes`, `acquiredAt`, `source`.

## CRM webhook (Digi Help Media CRM / n8n)

`POST /api/integrations/crm/webhook` with an API key that has `clients:write`.

```json
{ "event": "lead.status_changed", "lead": { "id": "L-123", "full_name": "Acme Foods", "phone_number": "+91…", "status": "Converted" } }
```

Leads whose status contains *converted / won / client / customer / onboard* (or events `client.upsert` / `client.created`) become clients; other events return `202 ignored`. Add `?all=1` to sync every lead.

## Outgoing webhooks

DHM Business OS POSTs JSON to your URL:

```json
{ "id": "uuid", "event": "invoice.paid", "createdAt": "2026-11-10T06:00:00.000Z", "source": "dhm-business-os", "data": { … } }
```

Headers: `X-DHM-Event`, `X-DHM-Delivery`, `X-DHM-Signature: sha256=<hex HMAC-SHA256 of the raw body with your signing secret>`. Non-2xx responses are retried up to 3 times (4xx except 429 are not retried). Every delivery is logged.

Events: `client.created`, `client.updated`, `quote.status_changed`, `invoice.issued`, `invoice.paid`, `invoice.cancelled`, `payment.recorded`, `payment.voided`, `transaction.created`, `bill.created`, `bill.paid`, `project.created`, `project.status_changed`, `task.completed`, `subscription.renewed`, `leave.requested`, plus `ping` from the Test button.

Verify (Node.js):

```js
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-dhm-signature"]));
```
