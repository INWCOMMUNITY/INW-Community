# Admin app and Vercel setup

This doc lists environment variables for the admin app and what to add in Vercel so the admin site works against the live main site.

## Local .env (root or apps/main)

Use a single `.env` at the repo root. For admin to work locally and for the main site to accept admin API calls from a deployed admin app, ensure these are set:

```bash
# ---- Admin: code-based login and API ----
# Shared secret: admin app sends this in x-admin-code header; main site validates it.
ADMIN_CODE=your-secret-code

# Optional: same value as ADMIN_CODE, used by admin app at build time for login form + header.
# If unset, admin app falls back to "NWC36481".
NEXT_PUBLIC_ADMIN_CODE=your-secret-code

# Main site URL. Admin app calls this for /api/admin/*. Set to live URL in production admin build.
NEXT_PUBLIC_MAIN_SITE_URL=https://inwcommunity.com

# Admin user for main site login (optional). If set, requireAdmin() also accepts a session with this email.
ADMIN_EMAIL=your-admin@example.com
ADMIN_INITIAL_PASSWORD=your-secure-password
```

For the **main site** to allow CORS from your **deployed admin app**, add:

```bash
# Comma-separated list of admin app origins that may call /api/admin. No trailing slashes.
ADMIN_APP_ORIGIN=https://admin.inwcommunity.com
```

Use your real admin deployment URL. Multiple origins: `https://admin.inwcommunity.com,https://admin-xyz.vercel.app`.

---

## Copy-paste for Vercel

**Where to add them:** Vercel Dashboard → your project → **Settings** → **Environment Variables**. Use **Bulk Edit** (or add one by one), choose **Production** (and **Preview** if you use preview deployments), then paste and replace the placeholders.

**To reuse your existing values:** Open `.env` at the repo root — copy `ADMIN_CODE` / `NEXT_PUBLIC_ADMIN_CODE`, `ADMIN_EMAIL`, and `NEXT_PUBLIC_MAIN_SITE_URL` from there into the blocks below (and set `ADMIN_APP_ORIGIN` to your deployed admin URL).

### Main site project (inwcommunity.com)

Paste this, then replace `YOUR_ADMIN_CODE` and `YOUR_ADMIN_APP_URL` with your real values. If `ADMIN_EMAIL` is already set in Vercel, skip that line or leave it to avoid overwriting.

```
ADMIN_CODE=YOUR_ADMIN_CODE
ADMIN_EMAIL=your-admin@example.com
ADMIN_APP_ORIGIN=https://YOUR_ADMIN_APP_URL
```

Example with placeholders filled (use your own code and URL):

```
ADMIN_CODE=NWC36481
ADMIN_EMAIL=admin@inwcommunity.com
ADMIN_APP_ORIGIN=https://admin.inwcommunity.com
```

### Admin app project

Paste this, then replace `YOUR_MAIN_SITE_URL` and `YOUR_ADMIN_CODE` (must match main site’s `ADMIN_CODE`).

```
NEXT_PUBLIC_MAIN_SITE_URL=https://YOUR_MAIN_SITE_URL
NEXT_PUBLIC_ADMIN_CODE=YOUR_ADMIN_CODE
```

Example:

```
NEXT_PUBLIC_MAIN_SITE_URL=https://inwcommunity.com
NEXT_PUBLIC_ADMIN_CODE=NWC36481
```

After saving, trigger a redeploy for each project so the new variables are used.

---

## Vercel – Main site (inwcommunity.com)

In the **main site** project (Settings → Environment Variables), ensure these are set for **Production** (and Preview if you want admin to work there too):

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_CODE` | Secret code the admin app sends in `x-admin-code` header. Must match what the admin app is built with. | Same value you use for `NEXT_PUBLIC_ADMIN_CODE` in the admin project |
| `ADMIN_EMAIL` | (Optional) Admin user email for session-based admin. You said this is already set. | your-admin@example.com |
| `ADMIN_APP_ORIGIN` | **Required for admin to work.** The URL of your deployed admin app (no trailing slash). Enables CORS so the browser allows API calls from admin to main. | `https://admin.inwcommunity.com` or your admin Vercel URL |

If `ADMIN_APP_ORIGIN` is missing, the main site only allows `http://localhost:3001`, so the deployed admin will get CORS errors and the dashboard will not load data.

---

## Vercel – Admin app (separate project)

If you deploy the admin app as its own Vercel project (e.g. `admin.inwcommunity.com` or `your-project-admin.vercel.app`), add these for **Production** (and Preview if needed):

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_MAIN_SITE_URL` | Main site base URL. Admin calls `{this}/api/admin/*`. | `https://inwcommunity.com` |
| `NEXT_PUBLIC_ADMIN_CODE` | Same secret as `ADMIN_CODE` on the main site. Used for the login form and for the `x-admin-code` header on every API request. | Same value as `ADMIN_CODE` on main |

Redeploy the admin app after adding or changing these so they are baked into the build.

---

## Summary checklist

**Main site (Vercel):**

- [ ] `ADMIN_CODE` set (and matches admin’s `NEXT_PUBLIC_ADMIN_CODE`)
- [ ] `ADMIN_EMAIL` set (you said this is already done)
- [ ] `ADMIN_APP_ORIGIN` set to your deployed admin URL (e.g. `https://admin.inwcommunity.com`)

**Admin app (Vercel):**

- [ ] `NEXT_PUBLIC_MAIN_SITE_URL` = your live main site URL
- [ ] `NEXT_PUBLIC_ADMIN_CODE` = same value as main site’s `ADMIN_CODE`

After that, open the admin URL, enter the admin code, and the dashboard should load data from the live site.
