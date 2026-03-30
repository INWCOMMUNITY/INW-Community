# Deploying to Vercel

## One-time Vercel setup

1. **Root Directory** – Leave **empty** (repo root). The root `vercel.json` defines `outputDirectory: "apps/main/.next"` for the monorepo.

2. **Environment variables** – In **Settings** → **Environment Variables**, add:

   | Variable        | Required | Notes                                                |
   |-----------------|----------|------------------------------------------------------|
   | `DATABASE_URL`  | Yes      | PostgreSQL connection string (e.g. Neon, Supabase)   |
   | `NEXTAUTH_URL`  | Yes      | Production URL (e.g. `https://yoursite.com`)        |
   | `NEXTAUTH_SECRET` | Yes   | Generate with `openssl rand -base64 32`             |
   | `STRIPE_*`      | For payments | Stripe live keys and price IDs                    |

3. **VERCEL_TOKEN** – For build automation scripts, add to your local `.env`:
   ```
   VERCEL_TOKEN=your_token_from_vercel.com/account/tokens
   ```
   Keep this private; it is gitignored.

## Editing the live site

The admin dashboard edits **the same site it runs on**:

- **https://inwcommunity.com/admin** → edits the live site (production)
- **http://localhost:3000/admin** → edits your local database

To edit the live site, use **https://inwcommunity.com/admin** (not localhost). Ensure Vercel has `NEXTAUTH_URL` and `DATABASE_URL` set to production values so the deployed admin connects to your live data.

## Prisma: P3018 / `type "Plan" already exists` (squashed `20250101000000_init`)

If Vercel build fails during `pnpm db:migrate:deploy` with **P3018** on migration `20250101000000_init`, production already has the full schema from **older** migration names. The squashed init must **not** run its SQL there.

**One-time fix** (from your machine, with production DB URL):

1. Put the production connection string in **root** `.env` as **`DATABASE_URL`** and/or **`DATABASE_URL_PRODUCTION`** (same value as Vercel; use a **direct** Neon URL if you use pooling — see `scripts/migrate-deploy.mjs`). The resolve script **always prefers root `.env` for** `DATABASE_URL`, `DATABASE_URL_PRODUCTION`, `DATABASE_URL_UNPOOLED`, and `DIRECT_URL` **over** `apps/main/.env` and **`packages/database/.env`** (those often use `localhost` for local Prisma/Next). The script still **refuses** if the resolved URL is localhost unless you set `RESOLVE_SQUASHED_INIT_ALLOW_LOCAL=1`.
2. Run:

   ```bash
   pnpm db:resolve-squashed-init
   ```

   This marks `20250101000000_init` as applied without executing it (or **skips** that step with **P3008** if it is already applied), then runs `migrate deploy` for any **new** migrations (e.g. `20250329190000_group_allow_business_posts`).

   For a **local** Postgres only, run: `RESOLVE_SQUASHED_INIT_ALLOW_LOCAL=1 pnpm db:resolve-squashed-init` (PowerShell: `$env:RESOLVE_SQUASHED_INIT_ALLOW_LOCAL=1; pnpm db:resolve-squashed-init`).

3. Trigger a new Vercel deployment.

If you instead see errors about migrations **present in the database but missing from the repo**, the `_prisma_migrations` history must be reconciled with [Prisma’s troubleshooting guide](https://www.prisma.io/docs/guides/migrate/production-troubleshooting); contact the team before editing that table.

## Seeding production (businesses, badges, etc.)

To add or update seed data (businesses, coupons, badges) on the live site:

1. Add `DATABASE_URL_PRODUCTION` to your local `.env` – copy the value from **Vercel → Project → Settings → Environment Variables** (the `DATABASE_URL` used in production).
2. If production schema is behind (e.g. seed fails with "column X does not"), apply migrations. If you see **P3005** ("The database schema is not empty"), run once: `pnpm db:baseline:prod` (marks existing migrations as applied, then runs new ones). Otherwise: `pnpm db:migrate:prod`
3. Run: `pnpm db:seed:prod`

The seed will run against the production database and create/update businesses, Northwest Community, coupons, etc.

## Build automation

### Single cycle

```bash
pnpm vercel:logs    # Fetch latest build log only
pnpm vercel:cycle   # Commit + push + wait for build + fetch logs (exit 0=success, 1=fail)
pnpm vercel:parse   # Parse last-vercel-build.log and print error summary + suggested fix
```

### Iterative fix loop (manual or with AI)

1. Make code changes.
2. Run `pnpm vercel:cycle`.
3. If it fails, open `last-vercel-build.log` for the error.
4. Fix the error, then repeat from step 1 until the build succeeds.

`vercel:cycle` will commit and push uncommitted changes before triggering a new deployment.
