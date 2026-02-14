# Northwest Community – Troubleshooting Guide

## Quick Start (Recommended)

**Use dev mode** – it works reliably on Windows:

1. Double-click **`run-main-clean.cmd`** (cleans cache and starts server)
2. Or run: `pnpm --filter main dev`
3. Open **http://localhost:3000**

---

## Common Issues

### "It is not loading" / Blank page / HTTP 500 / "Cannot find module './xxxx.js'"

**Cause:** Corrupted or stale Next.js build cache (common on Windows). JavaScript chunks return 404, so the page never hydrates.

**Fix:**
1. **Stop** any running dev server (Ctrl+C in the terminal).
2. **Kill port 3000** if needed: `netstat -ano | findstr :3000` then `taskkill /PID <number> /F`
3. **Delete the build cache:**
   - **PowerShell:** `Remove-Item -Recurse -Force apps\main\.next`
   - **CMD:** `rmdir /s /q apps\main\.next`
4. **Start fresh:** Double-click **`run-main-clean.cmd`** in File Explorer (run **outside** Cursor – Cursor's terminal can block Node).
5. Wait for "Ready" before opening http://localhost:3000

---

### Port 3000 Already in Use (EADDRINUSE)

**Cause:** Another process is using port 3000 (old server, other app).

**Fix:**
1. Find the process: `netstat -ano | findstr :3000`
2. Kill it: `taskkill /PID <number> /F` (use elevated Command Prompt if needed)
3. Or use a different port: `pnpm --filter main dev:3001` → http://localhost:3001

---

### Production Mode (next start) Fails

**Cause:** Known Next.js issue on Windows – webpack chunk paths resolve incorrectly in production builds.

**Workaround:** Use **dev mode** (`next dev`) for local development. Dev mode compiles on demand and avoids this bug.

For deployment, use Vercel or another host – production builds work there.

---

### Database Connection Failed

**Fix:**
1. Ensure PostgreSQL is running: `net start postgresql-x64-16` (or your service name)
2. Check `DATABASE_URL` in `apps/main/.env` and root `.env`
3. Run migrations: `pnpm db:push` from project root
4. Test: visit http://localhost:3000/api/health – should return `{"ok":true,"db":"connected"}`

---

### Shipping is not configured

**Cause:** `EASYPOST_API_KEY` is missing. Shipping labels and rates use EasyPost.

**Fix:**
1. Sign up at [easypost.com](https://www.easypost.com).
2. Go to [Account → API Keys](https://www.easypost.com/account/api-keys).
3. Copy your **Test** or **Production** API key (starts with `EZAK`).
4. Add to **`apps/main/.env`**:
   ```
   EASYPOST_API_KEY="EZAKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```
5. Restart the dev server.

---

### Stripe is not configured / Add STRIPE_SECRET_KEY for storefront payments

**Cause:** `STRIPE_SECRET_KEY` is missing or still set to the placeholder `sk_test_...`.

**Fix:**
1. Sign up at [stripe.com](https://stripe.com) if needed.
2. Go to [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys).
3. Copy your **Secret key** (starts with `sk_test_` for test mode).
4. Add it to **`apps/main/.env`** (and root `.env` if you use it):
   ```
   STRIPE_SECRET_KEY="sk_test_..."  # get from Stripe Dashboard
   ```
5. Restart the dev server.

**Note:** Use test keys (`sk_test_...`) for local development. Never commit real keys to git.

---

### Sponsor Hub 500 (Redirect Issue)

**Fixed.** If you still see 500 on `/sponsor-hub` when not logged in, it should redirect to login. Clear `.next` and restart.

---

### PowerShell: rmdir /s /q Fails

**Cause:** `rmdir /s /q` is CMD syntax, not PowerShell.

**PowerShell equivalent:**
```powershell
Remove-Item -Recurse -Force apps\main\.next
```

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `run-main.cmd` | Start dev server (port 3000) |
| `run-main-clean.cmd` | Delete `.next`, then start dev server |
| `run-main-npm.cmd` | Start dev server using npm (if pnpm has spawn issues) |

---

## Test Checklist

After starting the server, verify:

- [ ] http://localhost:3000/ – Home page loads
- [ ] http://localhost:3000/api/health – Returns `{"ok":true,"db":"connected"}`
- [ ] http://localhost:3000/login – Login page loads
- [ ] http://localhost:3000/sponsor-hub – Redirects to login if not signed in
