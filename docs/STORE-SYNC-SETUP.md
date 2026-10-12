# Store Sync — Step-by-Step To-Do (with links)

Check off each box as you go. Every section has **links to the right website**, **numbered clicks** to find keys, and **exact Vercel variable names** to paste.

| | |
|---|---|
| **Where you paste keys** | [Vercel → main app → Settings → Environment Variables](https://vercel.com/docs/projects/environment-variables) |
| **After any env change** | **Redeploy** the main app (keys do nothing until redeploy) |
| **Production site** | `https://www.inwcommunity.com` |
| **Test in the app** | Seller Hub → **Sync Stores** |

**Recommended order:** Part A (once) → Etsy → eBay → Shopify

---

## Quick map: site → portal → keys → Vercel

| Store | Open this portal | Keys you copy | Paste in Vercel as |
|-------|------------------|---------------|-------------------|
| **Etsy** | [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps) | Keystring, Shared secret, Callback URL | `ETSY_API_KEY`, `ETSY_CLIENT_SECRET`, `ETSY_REDIRECT_URI` |
| **eBay** | [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys) + [RuNames](https://developer.ebay.com/my/auth/?env=production&index=0) | App ID, Cert ID, RuName **string** | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME` |
| **Shopify** | [partners.shopify.com](https://partners.shopify.com/) → your app | Client ID, Client secret | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` |

**Already in Vercel (do not add again):** `ENCRYPTION_KEY`, `CRON_SECRET`, `NEXTAUTH_SECRET`

**Error tracking (optional):** Add `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (same value) for server/client error capture. Add `SENTRY_AUTH_TOKEN` for source maps upload during build.

---

## Part A — Shared setup (Etsy, eBay, and Shopify)

Do this once before connecting any marketplace.

- [ ] **A1 — Vercel secrets**  
  Open [Environment Variables](https://vercel.com/docs/projects/environment-variables) for the **main** project. Confirm these exist:
  - `ENCRYPTION_KEY`
  - `CRON_SECRET`
  - `NEXTAUTH_SECRET`

- [ ] **A2 — Database**  
  Deploy so migrations run automatically. Tables you need in production:
  - `channel_connection`
  - `channel_listing_link`
  - `channel_sync_event`  

  Manual run if needed:
  ```bash
  cd packages/database
  npx prisma migrate deploy
  ```

- [ ] **A3 — Channel sync**  
  Etsy and Shopify drain their own sync-job crons. Optional legacy reconcile: `CHANNEL_CRON_SYNC_ENABLED=true` + `GET /api/cron/sync-channels` with `CRON_SECRET`.

- [ ] **A4 — Policies**  
  Review `apps/main/src/lib/terms-content.ts` and `privacy-content.ts`. Re-export PDFs if you distribute them.

- [ ] **A5 — Rule for every store below**  
  After you add keys for Etsy, eBay, or Shopify → **Redeploy** → test **Connect** in the app.

---

## Part B — Etsy

### B — Links bookmark

| Step | Link |
|------|------|
| Sign in / create apps | [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps) |
| Etsy developer docs | [developers.etsy.com/documentation](https://developers.etsy.com/documentation/) |
| Register as developer (if needed) | [etsy.com/developers/register](https://www.etsy.com/developers/register) |
| **Callback URL to register** | `https://www.inwcommunity.com/api/etsy/oauth/callback` |
| Legacy callback (still accepted) | `https://www.inwcommunity.com/api/channels/etsy/callback` |
| Order webhook URL (required for SALE-causal qty) | `https://www.inwcommunity.com/api/etsy/webhooks/inbox` |
| Local dev callback (optional) | `http://localhost:3000/api/etsy/oauth/callback` |

### B — To-do checklist

- [ ] B1 Create Etsy developer app
- [ ] B2 Request **Commercial / production** access (can take several days)
- [ ] B3 Register OAuth callback URL (exact match required)
- [ ] B4 Copy Keystring + Shared secret → Vercel
- [ ] B5 Redeploy main app
- [ ] B6 Webhooks + `ETSY_WEBHOOK_SECRET` (required for SALE-causal qty; without it, poll uses MQE)
- [ ] B7 Test: Connect → Import → Create → Sell on Etsy & INW → Disconnect

### B — Find API keys (numbered clicks)

1. Go to **[Your apps](https://www.etsy.com/developers/your-apps)** and sign in.
2. Click **Create a new app** (or open your existing INW app).
3. Fill in **App name**, **description**, and **website** (`https://www.inwcommunity.com`).
4. **Commercial access:** In the app dashboard, find **Request Production Access** or **Commercial Access** and submit. Wait for approval before many sellers can use OAuth.
5. **Callback URL:**
   - Find **OAuth redirect URIs** / **Callback URLs**.
   - Add **exactly:** `https://www.inwcommunity.com/api/etsy/oauth/callback`
   - This must match `ETSY_REDIRECT_URI` in Vercel **character for character** (no trailing slash unless Etsy shows one).
6. **`ETSY_API_KEY` ← Keystring:**
   - On the app overview, find **Keystring** (may say **API key**).
   - Copy the whole string.
7. **`ETSY_CLIENT_SECRET` ← Shared secret:**
   - Same page → **Shared secret** → reveal → copy.
   - Never commit to git; only Vercel + local `.env`.
8. **`ETSY_REDIRECT_URI`:**
   - Paste: `https://www.inwcommunity.com/api/etsy/oauth/callback`
9. **`ETSY_CLIENT_ID` (optional):** Only if Etsy shows a **different** Client ID than the keystring. Usually leave blank.
10. **`ETSY_WEBHOOK_SECRET` (required for sale-causal qty):** Configure Etsy order webhooks pointing to `https://www.inwcommunity.com/api/etsy/webhooks/inbox`, then copy Etsy’s signing secret. Without this, Etsy quantity drops observed on poll become marketplace quantity edits (MQE), not SALE facts — residual oversell risk.
11. **`ETSY_DEFAULT_TAXONOMY_ID` (optional):** A default category number from [Etsy taxonomy API](https://developers.etsy.com/documentation/reference#operation/getSellerTaxonomyNodes).

**Scopes our app uses:** `listings_r`, `listings_w`, `transactions_r`, `shops_r`, `shops_w`

Reconnect Etsy in Sync Airport if an older connection was granted without `shops_w` (needed for readiness-state create).

### B — Paste into Vercel

| Vercel name | Required? | You copied from Etsy |
|-------------|-----------|----------------------|
| `ETSY_API_KEY` | Yes | Keystring |
| `ETSY_CLIENT_SECRET` | Yes | Shared secret |
| `ETSY_REDIRECT_URI` | Yes | `https://www.inwcommunity.com/api/etsy/oauth/callback` |
| `ETSY_CLIENT_ID` | No | Only if ≠ keystring |
| `ETSY_WEBHOOK_SECRET` | Yes for SALE-causal qty | Webhook signing secret |
| `ETSY_DEFAULT_TAXONOMY_ID` | No | Category id number |
| `CRON_SECRET` | Yes | Shared with other crons; Bearer auth for `/api/cron/etsy-sync-jobs` |
| `ENCRYPTION_KEY` | Yes | Token encryption at rest |

### B — Two-way sync (Etsy ↔ INW)

**How it runs in production:** Vercel cron hits `/api/cron/etsy-sync-jobs` every **5 minutes** (root `vercel.json` + `apps/main/vercel.json`). That worker drains:

- `CREATE_LISTING` / `UPDATE_LISTING_CONTENT` / `PROJECT_INVENTORY` (outbound)
- `POLL_LISTING_CONTENT` (Etsy → INW title/desc/price/SKU/qty + photos observation)
- `RECONCILE_LISTING` / `PROCESS_PROVIDER_EVIDENCE` (health + order evidence)

Outbound edits also get a short **inline drain** after List on Etsy / store-item save. **Inbound poll and order evidence still need the cron.**

Do **not** use `CHANNEL_CRON_SYNC_ENABLED` for Etsy V2 sync — that flag is for the legacy `/api/cron/sync-channels` reconcile path, not `etsy-sync-jobs`.

**Qty quality:** Paid-order webhooks → sale facts → Foundation. Without webhooks, unexplained remote qty changes apply as MQE. Treat `ETSY_WEBHOOK_SECRET` + registered order topics as required before calling qty “production-ready.”

**If connect or listing fails:** Confirm `ETSY_REDIRECT_URI` is exactly `/api/etsy/oauth/callback`, the seller has an Etsy shipping profile selected in Connection settings, How it’s made is filled on the INW listing, and photos are publicly reachable (INW-hosted preferred).

### B — Tell sellers

- [ ] They need at least one **shipping profile** on Etsy, or synced listings stay **drafts** until they add one.
- [ ] Edits on Etsy sync to INW within ~5 minutes (via `etsy-sync-jobs` poll).
- [ ] Edits on INW sync to Etsy after save (inline drain + cron backlog).
- [ ] Live / View on Etsy only when Etsy reports the listing **active** (not draft).

### B — Test in app

1. Seller Hub → **Sync Airport** → **Connect Etsy** (scopes include `shops_w`)
2. Connection Settings → default **shipping profile**
3. **Import** an active listing (Size×Color if available)
4. Create/list item with How it’s made + photos → expect **active** / Live (not draft / `IMAGES_REQUIRED`)
5. Edit INW title + qty → Etsy updates after cron/inline drain
6. Edit Etsy title → INW within ~5 minutes
7. Sell on Etsy (webhook) → INW quantity drops as SALE (not MQE)
8. Sell on INW → Etsy quantity drops
9. **Disconnect** → Etsy listing stays; sync stops

### B — Pre-deploy smoke checklist

- [ ] Vercel Cron UI lists `/api/cron/etsy-sync-jobs` (every 5m) and a manual run returns JSON with `discovered`/`processed` using `Authorization: Bearer $CRON_SECRET`
- [ ] Env present: `ETSY_API_KEY`, `ETSY_CLIENT_SECRET`, `ETSY_REDIRECT_URI` (or `ETSY_APP_URL`), `CRON_SECRET`, `ENCRYPTION_KEY`
- [ ] Etsy order webhooks → `/api/etsy/webhooks/inbox` + `ETSY_WEBHOOK_SECRET` set
- [ ] OAuth grant includes `shops_w` (reconnect if needed)
- [ ] Seller smoke: shipping profile → how-made → photos → List → `remoteListingState=active`
- [ ] Title + qty both directions; paid order applies as SALE when webhooks live
- [ ] Import one active multi-variant Size×Color listing
- [ ] Before merge to `main`: `git merge-base --is-ancestor aff1b745 HEAD` succeeds; keep Shopify `listing-actions.ts` `loadMappedListing` error `{ error: string; status: number }` if conflicted

**You're done with Etsy when:** Connect works, import works, cron drains jobs, Live requires active, and a test sale updates quantity both ways with SALE causality (webhooks).

---

## Part C — eBay

**Production only** — no sandbox in our app. Sales sync via **Platform Notifications** (`/api/channels/ebay/webhook`) plus optional `CHANNEL_CRON_SYNC_ENABLED` sales poll as backstop.

### C — Links bookmark

| Step | Link |
|------|------|
| eBay Developers sign in | [developer.ebay.com](https://developer.ebay.com/) |
| **Production keys** (App ID + Cert ID) | [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys) |
| **RuNames** (OAuth redirect name) | [developer.ebay.com/my/auth/?env=production&index=0](https://developer.ebay.com/my/auth/?env=production&index=0) |
| OAuth guide | [developer.ebay.com/api-docs/static/oauth-consent-request.html](https://developer.ebay.com/api-docs/static/oauth-consent-request.html) |
| **RuName “auth accepted URL”** (not `EBAY_RUNAME`) | `https://www.inwcommunity.com/api/channels/ebay/callback` |
| **Account deletion endpoint** (required before keys work) | `https://www.inwcommunity.com/api/channels/ebay/account-deletion` |
| Account deletion guide | [developer.ebay.com/marketplace-account-deletion](https://developer.ebay.com/marketplace-account-deletion) |
| Seller policies (tell sellers) | [ebay.com/sh/ovw](https://www.ebay.com/sh/ovw) |

### C — To-do checklist

- [ ] C0 Enable Production keyset (Marketplace Account Deletion — see below)
- [ ] C1 Create **Production** keyset (not Sandbox)
- [ ] C2 Create **RuName** with auth accepted URL = our callback
- [ ] C3 Copy App ID, Cert ID, RuName **string** → Vercel
- [ ] C4 Confirm Platform Notifications delivery URL → `/api/channels/ebay/webhook?secret=YOUR_SECRET` (the `?secret=` value must match `EBAY_WEBHOOK_SECRET` in Vercel). Optional cron backstop: `CHANNEL_CRON_SYNC_ENABLED=true`
- [ ] C4b Add `EBAY_WEBHOOK_SECRET` to Vercel (a random 32+ char string). Without this, the webhook rejects all POSTs with 401.
- [ ] C5 Redeploy main app
- [ ] C6 Test: Connect → Import → Publish → Sell both ways

### C — Enable Production keyset (Marketplace Account Deletion)

eBay disables new Production keys until you validate an account-deletion endpoint.

1. **Deploy** the main app (route: `/api/channels/ebay/account-deletion`).
2. In **Vercel**, add `EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN` — a random 32–80 character string (letters, numbers, `_`, `-` only). **Redeploy.**
3. In eBay → Application Keys → **INW Community** → **Notifications**:
   - Event type: **Marketplace Account Deletion**
   - Alert email: your email
   - Notification Endpoint URL: `https://www.inwcommunity.com/api/channels/ebay/account-deletion`
   - Verification token: **the same string** as `EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN`
4. Click **Save**. eBay sends a GET challenge; our endpoint responds automatically.
5. If validation fails, set optional `EBAY_ACCOUNT_DELETION_ENDPOINT` in Vercel to the **exact** URL you typed in eBay (no trailing slash), redeploy, and save again in eBay.

| Vercel name | Required? | Notes |
|-------------|-----------|-------|
| `EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN` | Yes (to enable keys) | Must match eBay portal token exactly |
| `EBAY_ACCOUNT_DELETION_ENDPOINT` | No | Only if challenge validation fails due to URL mismatch |

### C — Find API keys (numbered clicks)

1. Sign in at **[developer.ebay.com](https://developer.ebay.com/)**.
2. Open **[Application Keys](https://developer.ebay.com/my/keys)**.
3. Under **Production** (not Sandbox), click **Create a keyset** or use an existing one.
4. **`EBAY_CLIENT_ID`:**
   - On the keyset card, copy **App ID (Client ID)**.
5. **`EBAY_CLIENT_SECRET`:**
   - Same card → copy **Cert ID (Client Secret)**.
6. **`EBAY_RUNAME` (this is a short code, NOT a URL):**
   - Go to **[User Tokens → Production](https://developer.ebay.com/my/auth/?env=production&index=0)**.
   - Section **RuName** (Redirect URL name) → **Create RuName** or edit one.
   - Set **Your auth accepted URL** to exactly:  
     `https://www.inwcommunity.com/api/channels/ebay/callback`
   - Save. Copy the **RuName value** — looks like `YourName-YourApp-PRD-abc123-xyz789`.
   - Paste that string as `EBAY_RUNAME`. **Do not** paste the callback URL into `EBAY_RUNAME`.
7. **Scopes:** Your keyset must allow Sell APIs. We request:
   - `sell.inventory`
   - `sell.account`
   - `sell.fulfillment`
   - `commerce.identity.readonly`
8. **`EBAY_DEFAULT_CATEGORY_ID` (optional):** Leaf category id from [eBay Taxonomy](https://developer.ebay.com/api-docs/commerce/taxonomy/overview.html) or Seller Hub category picker.

### C — Paste into Vercel

| Vercel name | Required? | You copied from eBay |
|-------------|-----------|----------------------|
| `EBAY_CLIENT_ID` | Yes | App ID (Client ID) — Production keyset |
| `EBAY_CLIENT_SECRET` | Yes | Cert ID (Client Secret) |
| `EBAY_RUNAME` | Yes | RuName **string** only |
| `EBAY_WEBHOOK_SECRET` | Yes (for webhooks) | Random 32+ char string; must match `?secret=` in the Platform Notifications URL |
| `CHANNEL_CRON_SYNC_ENABLED` | Optional | Manual/cron backstop for sales + catalog reconcile (webhooks are primary) |
| `EBAY_DEFAULT_CATEGORY_ID` | No | Leaf category id |

### C — Tell sellers

- [ ] **Business Policies** on eBay: payment, return, fulfillment/shipping ([Seller Hub](https://www.ebay.com/sh/ovw))
- [ ] At least one **merchant location**
- Without these, listings stay **unpublished** until they fix eBay and re-save in INW
- **Item details (eBay item specifics):** When eBay is connected, the listing form shows a live **eBay category** search and an **"Add a detail"** section (Descriptor + Value, e.g. Brand → Nike). Picking a category pre-fills the details eBay **requires** for that category; sellers must fill required values before saving or eBay will reject the publish. Titles are capped at **80 characters** (eBay's limit) on both the app and website.

### C — Test in app

1. Sync Stores → **Connect eBay**
2. Fix policy/location warning if shown
3. **Import existing listings** (some legacy listings may skip — app shows why). Imported items pull eBay's **category + item specifics + description** so they round-trip.
4. Create/edit on INW → pick an eBay category, fill required details → check eBay listing shows the same item specifics
5. Sell on eBay / INW → qty syncs (~15 min)

**You're done with eBay when:** OAuth connects, import works, item specifics appear on both sides, and quantities update after a test sale.

---

## Part E — Shopify

Each seller connects their own `{shop}.myshopify.com`. After OAuth we store a **non-expiring offline** Admin API token per shop.

### E — Links bookmark

| Step | Link |
|------|------|
| Shopify Partners | [partners.shopify.com](https://partners.shopify.com/) |
| Create / manage apps | Partners → your org → **Apps** |
| App auth docs | [shopify.dev — authentication](https://shopify.dev/docs/apps/build/authentication-authorization) |
| Access scopes list | [shopify.dev — access scopes](https://shopify.dev/docs/api/usage/access-scopes) |
| App review (many merchants) | [shopify.dev — app review](https://shopify.dev/docs/apps/launch/app-review) |
| **Allowed redirection URL** | `https://www.inwcommunity.com/api/channels/shopify/callback` |
| Local dev callback (optional) | `http://localhost:3000/api/channels/shopify/callback` |

### E — To-do checklist

- [ ] E1 Create Partner app (manual / custom)
- [ ] E2 Set allowed redirection URL(s)
- [ ] E3 Enable Admin API scopes (products, inventory, orders)
- [ ] E4 Copy Client ID + Client secret → Vercel
- [ ] E5 Redeploy main app
- [ ] E6 (If many merchants) Plan [app review](https://shopify.dev/docs/apps/launch/app-review)
- [ ] E7 Subscribe webhooks → `https://www.inwcommunity.com/api/channels/shopify/webhook` for `orders/paid`, `inventory_levels/update`, `products/update`, `products/delete`
- [ ] E8 Test: enter shop domain → Connect → Import → Sync

### E — Find API keys (numbered clicks)

1. Go to **[Shopify Partners](https://partners.shopify.com/)** and sign in.
2. Select your organization → **Apps** → **Create app** → **Create app manually**.
3. Name the app (e.g. “INW Community Sync”).
4. Open the app → **Configuration** / **App setup**.
5. **Allowed redirection URL(s):**
   - Add: `https://www.inwcommunity.com/api/channels/shopify/callback`
   - Optional dev: `http://localhost:3000/api/channels/shopify/callback`
6. **`SHOPIFY_API_KEY` ← Client ID:**
   - **Client credentials** / **API credentials** → copy **Client ID**.
7. **`SHOPIFY_API_SECRET` ← Client secret:**
   - Same section → **Client secret** → reveal → copy.
8. **Admin API scopes** (required):
   - **API access** / **Scopes** → enable:
     - `read_products`, `write_products`
     - `read_inventory`, `write_inventory`
     - `read_orders`
9. **Test store:** Use **Select store** / dev install on your own shop first.
10. **`SHOPIFY_API_VERSION` (optional):** Default in code is `2024-10`.
11. **`SHOPIFY_REDIRECT_URI` (optional):** Only if overriding callback URL.
12. **`SHOPIFY_DEFAULT_LOCATION_ID` (optional):** Multi-location shops — id from Admin → Settings → Locations or API.

**In the INW app:** Seller types `mystore` or `mystore.myshopify.com` **before** tapping **Connect Shopify**.

### E — Paste into Vercel

| Vercel name | Required? | You copied from Shopify Partners |
|-------------|-----------|----------------------------------|
| `SHOPIFY_API_KEY` | Yes | Client ID |
| `SHOPIFY_API_SECRET` | Yes | Client secret |
| `SHOPIFY_REDIRECT_URI` | No | Only if overriding callback |
| `SHOPIFY_API_VERSION` | No | e.g. `2024-10` |
| `SHOPIFY_DEFAULT_LOCATION_ID` | No | Location id |

### E — Tell sellers

- [ ] Enter shop domain before connect
- [ ] **Online Store** channel + **inventory tracking** on products
- [ ] One Shopify shop per INW account

### E — Test in app

1. Enter shop → **Connect Shopify** → approve in Shopify
2. Import → create/edit → sell on Shopify / INW (~15 min)
3. Disconnect → Shopify products remain

**You're done with Shopify when:** Connect works with shop domain, import works, quantities sync both ways.

---

## Master checklist (all sites on one page)

### Shared
- [ ] [Vercel env vars](https://vercel.com/docs/projects/environment-variables): `ENCRYPTION_KEY`, `CRON_SECRET`, `NEXTAUTH_SECRET`
- [ ] DB migrations deployed
- [ ] Policies reviewed

### Etsy — [your-apps](https://www.etsy.com/developers/your-apps)
- [ ] App + commercial access
- [ ] Callback: `https://www.inwcommunity.com/api/etsy/oauth/callback`
- [ ] `ETSY_API_KEY`, `ETSY_CLIENT_SECRET`, `ETSY_REDIRECT_URI`
- [ ] Redeploy + test

### eBay — [keys](https://developer.ebay.com/my/keys) + [RuNames](https://developer.ebay.com/my/auth/?env=production&index=0)
- [ ] Production keyset
- [ ] RuName auth URL = callback above
- [ ] `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`
- [ ] Redeploy + test

### Shopify — [partners.shopify.com](https://partners.shopify.com/)
- [ ] App + redirect URL + scopes
- [ ] `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`
- [ ] Redeploy + test with shop domain

---

## Callback URLs (copy-paste into each portal)

| Store | Register this exact URL |
|-------|-------------------------|
| Etsy | `https://www.inwcommunity.com/api/etsy/oauth/callback` |
| eBay (RuName **auth accepted URL** only) | `https://www.inwcommunity.com/api/channels/ebay/callback` |
| Shopify (Allowed redirection) | `https://www.inwcommunity.com/api/channels/shopify/callback` |

---

## Cheat sheet — paste into Vercel

```env
# Etsy — https://www.etsy.com/developers/your-apps
ETSY_API_KEY=
ETSY_CLIENT_SECRET=
ETSY_REDIRECT_URI=https://www.inwcommunity.com/api/etsy/oauth/callback

# eBay — https://developer.ebay.com/my/keys
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_RUNAME=

# Shopify — https://partners.shopify.com/
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_REDIRECT_URI=https://www.inwcommunity.com/api/channels/shopify/callback
```

**Optional extras:**

```env
ETSY_CLIENT_ID=
ETSY_WEBHOOK_SECRET=
ETSY_DEFAULT_TAXONOMY_ID=
EBAY_DEFAULT_CATEGORY_ID=
EBAY_WEBHOOK_SECRET=
SHOPIFY_API_VERSION=
SHOPIFY_DEFAULT_LOCATION_ID=
```

Do **not** change `ENCRYPTION_KEY`, `CRON_SECRET`, or `NEXTAUTH_SECRET` if they are already set.

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Etsy connect fails “redirect mismatch” | `ETSY_REDIRECT_URI` must match Etsy portal **exactly** |
| eBay connect fails | `EBAY_RUNAME` must be the **RuName string**, not the callback URL |
| Used eBay **Sandbox** keys | Use **Production** keyset only |
| Keys added in Vercel but connect still fails | **Redeploy** main app after saving env vars |
| Shopify “redirect_uri mismatch” | Allowed redirection URL in Partners must match our callback |
| Category not matching after import | Remote label may become a **custom** INW category if no preset is similar; edit category in app and save to push taxonomy/collection |
| Options not on Etsy after INW edit | Etsy needs taxonomy properties for the listing category; check Vercel logs for variant push failure |
| Shopify “too many variants” | Shopify caps at 3 options × 100 variants; reduce option axes in INW |
| Shipping not updating on Etsy | Ensure listing save ran; Etsy uses per-rate shipping profiles (`INW $X.XX`) created on first push |

---

**Workflow in one sentence:** Open the portal link → follow numbered steps → copy keys into the matching Vercel names → redeploy → test in **Seller Hub → Sync Stores**.
