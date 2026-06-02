# Store Sync — Step-by-Step To-Do (with links)

Check off each box as you go. Every section has **links to the right website**, **numbered clicks** to find keys, and **exact Vercel variable names** to paste.

| | |
|---|---|
| **Where you paste keys** | [Vercel → main app → Settings → Environment Variables](https://vercel.com/docs/projects/environment-variables) |
| **After any env change** | **Redeploy** the main app (keys do nothing until redeploy) |
| **Production site** | `https://www.inwcommunity.com` |
| **Test in the app** | Seller Hub → **Sync Stores** |

**Recommended order:** Part A (once) → Etsy → eBay → Wix → Shopify

---

## Quick map: site → portal → keys → Vercel

| Store | Open this portal | Keys you copy | Paste in Vercel as |
|-------|------------------|---------------|-------------------|
| **Etsy** | [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps) | Keystring, Shared secret, Callback URL | `ETSY_API_KEY`, `ETSY_CLIENT_SECRET`, `ETSY_REDIRECT_URI` |
| **eBay** | [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys) + [RuNames](https://developer.ebay.com/my/auth/?env=production&index=0) | App ID, Cert ID, RuName **string** | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME` |
| **Wix** | [dev.wix.com](https://dev.wix.com/) → your app → OAuth | App ID, App Secret | `WIX_APP_ID`, `WIX_APP_SECRET` |
| **Shopify** | [partners.shopify.com](https://partners.shopify.com/) → your app | Client ID, Client secret | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` |

**Already in Vercel (do not add again):** `ENCRYPTION_KEY`, `CRON_SECRET`, `NEXTAUTH_SECRET`

---

## Part A — Shared setup (all four stores)

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

- [ ] **A3 — Cron job**  
  Vercel → your project → **Cron Jobs** → confirm:
  - Path: `GET /api/cron/sync-channels`
  - Schedule: every **15 minutes**

- [ ] **A4 — Policies**  
  Review `apps/main/src/lib/terms-content.ts` and `privacy-content.ts`. Re-export PDFs if you distribute them.

- [ ] **A5 — Rule for every store below**  
  After you add keys for Etsy, eBay, Wix, or Shopify → **Redeploy** → test **Connect** in the app.

---

## Part B — Etsy

### B — Links bookmark

| Step | Link |
|------|------|
| Sign in / create apps | [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps) |
| Etsy developer docs | [developers.etsy.com/documentation](https://developers.etsy.com/documentation/) |
| Register as developer (if needed) | [etsy.com/developers/register](https://www.etsy.com/developers/register) |
| **Callback URL to register** | `https://www.inwcommunity.com/api/channels/etsy/callback` |
| Optional webhook URL | `https://www.inwcommunity.com/api/channels/etsy/webhook` |
| Local dev callback (optional) | `http://localhost:3000/api/channels/etsy/callback` |

### B — To-do checklist

- [ ] B1 Create Etsy developer app
- [ ] B2 Request **Commercial / production** access (can take several days)
- [ ] B3 Register OAuth callback URL (exact match required)
- [ ] B4 Copy Keystring + Shared secret → Vercel
- [ ] B5 Redeploy main app
- [ ] B6 (Optional) Webhooks + `ETSY_WEBHOOK_SECRET`
- [ ] B7 Test: Connect → Import → Create → Sell on Etsy & INW → Disconnect

### B — Find API keys (numbered clicks)

1. Go to **[Your apps](https://www.etsy.com/developers/your-apps)** and sign in.
2. Click **Create a new app** (or open your existing INW app).
3. Fill in **App name**, **description**, and **website** (`https://www.inwcommunity.com`).
4. **Commercial access:** In the app dashboard, find **Request Production Access** or **Commercial Access** and submit. Wait for approval before many sellers can use OAuth.
5. **Callback URL:**
   - Find **OAuth redirect URIs** / **Callback URLs**.
   - Add **exactly:** `https://www.inwcommunity.com/api/channels/etsy/callback`
   - This must match `ETSY_REDIRECT_URI` in Vercel **character for character** (no trailing slash unless Etsy shows one).
6. **`ETSY_API_KEY` ← Keystring:**
   - On the app overview, find **Keystring** (may say **API key**).
   - Copy the whole string.
7. **`ETSY_CLIENT_SECRET` ← Shared secret:**
   - Same page → **Shared secret** → reveal → copy.
   - Never commit to git; only Vercel + local `.env`.
8. **`ETSY_REDIRECT_URI`:**
   - Paste: `https://www.inwcommunity.com/api/channels/etsy/callback`
9. **`ETSY_CLIENT_ID` (optional):** Only if Etsy shows a **different** Client ID than the keystring. Usually leave blank.
10. **`ETSY_WEBHOOK_SECRET` (optional):** Only if you configure webhooks in Etsy pointing to our webhook URL → copy Etsy’s signing secret.
11. **`ETSY_DEFAULT_TAXONOMY_ID` (optional):** A default category number from [Etsy taxonomy API](https://developers.etsy.com/documentation/reference#operation/getSellerTaxonomyNodes).

**Scopes our app uses:** `listings_r`, `listings_w`, `transactions_r`, `shops_r`

### B — Paste into Vercel

| Vercel name | Required? | You copied from Etsy |
|-------------|-----------|----------------------|
| `ETSY_API_KEY` | Yes | Keystring |
| `ETSY_CLIENT_SECRET` | Yes | Shared secret |
| `ETSY_REDIRECT_URI` | Yes | `https://www.inwcommunity.com/api/channels/etsy/callback` |
| `ETSY_CLIENT_ID` | No | Only if ≠ keystring |
| `ETSY_WEBHOOK_SECRET` | No | Webhook signing secret |
| `ETSY_DEFAULT_TAXONOMY_ID` | No | Category id number |

### B — Tell sellers

- [ ] They need at least one **shipping profile** on Etsy, or synced listings stay **drafts** until they add one.

### B — Test in app

1. Seller Hub → **Sync Stores** → **Connect Etsy**
2. **Import existing listings**
3. Create/edit item with Etsy sync on
4. Sell on Etsy → INW quantity drops (~15 min, or faster with webhook)
5. Sell on INW → Etsy quantity drops
6. **Disconnect** → Etsy listing stays; sync stops

**You're done with Etsy when:** Connect works, import works, and a test sale updates quantity both ways.

---

## Part C — eBay

**Production only** — no sandbox in our app. Sales sync via the **15-minute cron** (no eBay webhook in v1).

### C — Links bookmark

| Step | Link |
|------|------|
| eBay Developers sign in | [developer.ebay.com](https://developer.ebay.com/) |
| **Production keys** (App ID + Cert ID) | [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys) |
| **RuNames** (OAuth redirect name) | [developer.ebay.com/my/auth/?env=production&index=0](https://developer.ebay.com/my/auth/?env=production&index=0) |
| OAuth guide | [developer.ebay.com/api-docs/static/oauth-consent-request.html](https://developer.ebay.com/api-docs/static/oauth-consent-request.html) |
| **RuName “auth accepted URL”** (not `EBAY_RUNAME`) | `https://www.inwcommunity.com/api/channels/ebay/callback` |
| Seller policies (tell sellers) | [ebay.com/sh/ovw](https://www.ebay.com/sh/ovw) |

### C — To-do checklist

- [ ] C1 Create **Production** keyset (not Sandbox)
- [ ] C2 Create **RuName** with auth accepted URL = our callback
- [ ] C3 Copy App ID, Cert ID, RuName **string** → Vercel
- [ ] C4 Redeploy main app
- [ ] C5 Test: Connect → Import → Publish → Sell both ways

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
| `EBAY_DEFAULT_CATEGORY_ID` | No | Leaf category id |

### C — Tell sellers

- [ ] **Business Policies** on eBay: payment, return, fulfillment/shipping ([Seller Hub](https://www.ebay.com/sh/ovw))
- [ ] At least one **merchant location**
- Without these, listings stay **unpublished** until they fix eBay and re-save in INW

### C — Test in app

1. Sync Stores → **Connect eBay**
2. Fix policy/location warning if shown
3. **Import existing listings** (some legacy listings may skip — app shows why)
4. Create/edit on INW → check eBay
5. Sell on eBay / INW → qty syncs (~15 min)

**You're done with eBay when:** OAuth connects, import works, and quantities update after a test sale.

---

## Part D — Wix

Sellers **install your Wix app** on their site. You store the site `instanceId`; tokens are minted with your app secret (no per-seller refresh token).

### D — Links bookmark

| Step | Link |
|------|------|
| Wix Developers | [dev.wix.com](https://dev.wix.com/) |
| My Apps / create app | [dev.wix.com/apps](https://dev.wix.com/apps) |
| Permissions docs | [About permissions](https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/about-permissions) |
| **Install callback URL** | `https://www.inwcommunity.com/api/channels/wix/callback` |

### D — To-do checklist

- [ ] D1 Create Wix app
- [ ] D2 Add permissions (Stores + eCommerce orders)
- [ ] D3 Set External Install / redirect callback URL
- [ ] D4 Copy App ID + App Secret → Vercel
- [ ] D5 Redeploy main app
- [ ] D6 Test: Connect (install on test site) → Import → Sync qty

### D — Find API keys (numbered clicks)

1. Go to **[dev.wix.com](https://dev.wix.com/)** and sign in.
2. Click **Create New App** or open **[My Apps](https://dev.wix.com/apps)**.
3. Create an app (e.g. name: “INW Community Sync”).
4. **`WIX_APP_ID`:**
   - Open the app → **OAuth** or **Credentials**.
   - Copy **App ID** (sometimes labeled Client ID).
5. **`WIX_APP_SECRET`:**
   - Same screen → **App Secret** / **App Secret Key** → generate or reveal → copy.
6. **Permissions** (required):
   - Go to **Permissions** / **Scopes**.
   - Enable:
     - **Wix Stores** — products & inventory
     - **Wix eCommerce** — read orders
   - Optional: **Site Properties** — read (shop name in app)
7. **External Install / callback:**
   - Find **OAuth** → **Redirect URLs** or **External install** / **Post-installation URL**.
   - Set to: `https://www.inwcommunity.com/api/channels/wix/callback`
8. **`WIX_REDIRECT_URI` (optional):** Only set in Vercel if you override the default callback.
9. **`WIX_DEFAULT_LOCATION_ID` (optional):** For multi-location sites — location id from Wix Stores settings/API.

### D — Paste into Vercel

| Vercel name | Required? | You copied from Wix |
|-------------|-----------|---------------------|
| `WIX_APP_ID` | Yes | App ID |
| `WIX_APP_SECRET` | Yes | App Secret Key |
| `WIX_REDIRECT_URI` | No | Only if overriding callback |
| `WIX_DEFAULT_LOCATION_ID` | No | Location id |

### D — Tell sellers

- [ ] Their Wix site must have the **Wix Stores** app installed

### D — Test in app

1. Sync Stores → **Connect Wix** → install on a test site
2. Import → create/edit → sell on Wix / INW (~15 min)
3. Disconnect → Wix products remain

**You're done with Wix when:** Install completes, import works, and quantity syncs after a test sale.

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
- [ ] E7 Test: enter shop domain → Connect → Import → Sync

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
- [ ] Cron `sync-channels` every 15 min
- [ ] Policies reviewed

### Etsy — [your-apps](https://www.etsy.com/developers/your-apps)
- [ ] App + commercial access
- [ ] Callback: `https://www.inwcommunity.com/api/channels/etsy/callback`
- [ ] `ETSY_API_KEY`, `ETSY_CLIENT_SECRET`, `ETSY_REDIRECT_URI`
- [ ] Redeploy + test

### eBay — [keys](https://developer.ebay.com/my/keys) + [RuNames](https://developer.ebay.com/my/auth/?env=production&index=0)
- [ ] Production keyset
- [ ] RuName auth URL = callback above
- [ ] `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RUNAME`
- [ ] Redeploy + test

### Wix — [dev.wix.com](https://dev.wix.com/)
- [ ] App + permissions + install callback
- [ ] `WIX_APP_ID`, `WIX_APP_SECRET`
- [ ] Redeploy + test install

### Shopify — [partners.shopify.com](https://partners.shopify.com/)
- [ ] App + redirect URL + scopes
- [ ] `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`
- [ ] Redeploy + test with shop domain

---

## Callback URLs (copy-paste into each portal)

| Store | Register this exact URL |
|-------|-------------------------|
| Etsy | `https://www.inwcommunity.com/api/channels/etsy/callback` |
| eBay (RuName **auth accepted URL** only) | `https://www.inwcommunity.com/api/channels/ebay/callback` |
| Wix (External install / redirect) | `https://www.inwcommunity.com/api/channels/wix/callback` |
| Shopify (Allowed redirection) | `https://www.inwcommunity.com/api/channels/shopify/callback` |

---

## Cheat sheet — paste into Vercel

```env
# Etsy — https://www.etsy.com/developers/your-apps
ETSY_API_KEY=
ETSY_CLIENT_SECRET=
ETSY_REDIRECT_URI=https://www.inwcommunity.com/api/channels/etsy/callback

# eBay — https://developer.ebay.com/my/keys
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_RUNAME=

# Wix — https://dev.wix.com/
WIX_APP_ID=
WIX_APP_SECRET=
WIX_REDIRECT_URI=https://www.inwcommunity.com/api/channels/wix/callback

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
WIX_DEFAULT_LOCATION_ID=
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
| Wix install doesn’t return to app | Callback must be `https://www.inwcommunity.com/api/channels/wix/callback` |
| Shopify “redirect_uri mismatch” | Allowed redirection URL in Partners must match our callback |
| Sales slow to show in INW | Normal without webhooks — wait up to **15 minutes** for cron |

---

**Workflow in one sentence:** Open the portal link → follow numbered steps → copy keys into the matching Vercel names → redeploy → test in **Seller Hub → Sync Stores**.
