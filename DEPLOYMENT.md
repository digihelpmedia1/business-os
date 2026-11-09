# Deployment

DHM Business OS runs on **Vercel** with a **PostgreSQL** database. Any managed Postgres works (Supabase, Neon, Vercel Postgres, AWS RDS). Use a region close to Mumbai (`ap-south-1`) — `vercel.json` pins functions to `bom1`.

## 1. Database

Create a PostgreSQL 15+ database (UTF-8). You need two connection strings:

| Variable | Use |
|---|---|
| `DATABASE_URL` | Pooled connection used by the app (e.g. Supabase “Transaction pooler”, port 6543, append `?pgbouncer=true&connection_limit=1`) |
| `DIRECT_URL` | Direct connection used for migrations (port 5432) |

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | ✅ | See above |
| `AUTH_SECRET` | ✅ | ≥ 32 random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CRON_SECRET` | ✅ | Random string; Vercel Cron sends it as a Bearer token to `/api/cron/daily` |
| `APP_URL` | ✅ | Public URL, e.g. `https://business-os.vercel.app` (used in share links and API docs) |
| `STORAGE_DRIVER` | – | `db` (default, files in Postgres, ≤ 4 MB each) or `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | if `s3` | Any S3-compatible bucket (AWS S3, Cloudflare R2, Supabase Storage). Keep the bucket private. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | – | Enables the AI assistant (default model `claude-opus-5-5`) |

Never commit `.env` — it is git-ignored.

## 3. Deploy

The build command (`vercel.json` → `npm run vercel-build`) runs `prisma generate`, **`prisma migrate deploy`** and `next build`, so the schema is migrated automatically on every deploy.

```bash
vercel link
vercel env add …          # or use the dashboard
vercel deploy --prod
```

## 4. First admin user

Run the seed once against the production database from a trusted machine (it is idempotent and never overwrites existing data):

```bash
DATABASE_URL="<DIRECT_URL>" DIRECT_URL="<DIRECT_URL>" \
SEED_ADMIN_EMAIL="you@company.com" SEED_ADMIN_PASSWORD="<strong password>" SEED_ADMIN_NAME="Your Name" \
npm run db:seed
```

Then sign in, change the password (Profile → Change password), complete **Settings → Company & GST**, add bank accounts, and create users with roles in **Users & Access**.

## 5. Scheduled jobs

`vercel.json` schedules `/api/cron/daily` at 00:30 UTC (06:00 IST): recurring invoices are generated, unanswered quotations past expiry are marked expired, and reminders are refreshed. The app also refreshes reminders at most hourly while people use it, so reminders work even without the cron.

## 6. Backups

- Keep the provider's automatic daily backups / point-in-time recovery enabled.
- Off-site copy: `pg_dump "$DIRECT_URL" --format=custom --file=dhm-$(date +%F).dump` (restore with `pg_restore --clean --dbname "$DIRECT_URL" file.dump`).
- Settings → Data Export & Backup downloads a full JSON export and CSVs of every module.

## 7. Health check

`GET /api/health` returns `{"ok":true,"database":"up"}`.
