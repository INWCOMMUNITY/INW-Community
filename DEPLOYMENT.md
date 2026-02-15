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
