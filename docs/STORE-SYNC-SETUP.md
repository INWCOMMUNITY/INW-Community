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

- [ ] **A3 — Channel sync (event-driven)**  
  Production does **not** run a `sync-channels` cron. Wix quantity updates on listing save, storefront sale (`STRIPE_CONNECT_WEBHOOK_SECRET`), Wix inventory webhooks, and connect import. Optional manual reconcile: `CHANNEL_CRON_SYNC_ENABLED=true` + `GET /api/cron/sync-channels` with `CRON_SECRET`.

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
| **Account deletion endpoint** (required before keys work) | `https://www.inwcommunity.com/api/channels/ebay/account-deletion` |
| Account deletion guide | [developer.ebay.com/marketplace-account-deletion](https://developer.ebay.com/marketplace-account-deletion) |
| Seller policies (tell sellers) | [ebay.com/sh/ovw](https://www.ebay.com/sh/ovw) |

### C — To-do checklist

- [ ] C0 Enable Production keyset (Marketplace Account Deletion — see below)
- [ ] C1 Create **Production** keyset (not Sandbox)
- [ ] C2 Create **RuName** with auth accepted URL = our callback
- [ ] C3 Copy App ID, Cert ID, RuName **string** → Vercel
- [ ] C4 Set `CHANNEL_CRON_SYNC_ENABLED=true` in Vercel (enables eBay sales poll; no webhook in v1)
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
| `CHANNEL_CRON_SYNC_ENABLED` | Yes | Set to `true` — enables eBay sales polling (no eBay webhook in v1) |
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
     - **Wix Stores** — read/manage **products** (Catalog v3)
     - **Wix Stores** — read **inventory** (import needs real quantities)
     - **Wix eCommerce** — read **orders**
     - **Manage Your App** (resolve site id via app instance API)
     - Optional: **Site Properties** — read (shop name in app)
     - If import fails after connect, reconnect once after adding **inventory read**.
7. **Webhooks** (required for Wix inbound sync — there is no quantity cron):
   - Dev Center → your app → **Webhooks** → **Get Public Key** → save as `WIX_WEBHOOK_PUBLIC_KEY` in Vercel (without this, `/api/channels/wix/webhook` returns 503)
   - Callback URL: `https://www.inwcommunity.com/api/channels/wix/webhook`
   - Subscribe **all** that apply to your site (Wix shows Catalog **v1** and/or **v3** — enable both groups if listed):
     - **eCommerce:** Order Created, **Order Approved** (paid), Order Updated, Order Canceled
     - **Catalog v3 — products:** Product Created, Product Updated, Product Deleted
     - **Catalog v3 — inventory (enable all listed in Dev Center):**
       - Inventory tracking status changed
       - Inventory Item Created
       - Inventory Item Updated With Reason
       - Inventory Item Stock Status Updated
       - Inventory Item Deleted
     - **Catalog v1 (classic Editor):** Product Created, Product Changed, Product Deleted, **Variants Changed**
   - Skip unrelated events (contacts, bookings, carts) unless you need them
   - **Inventory webhooks** → pull live qty from Wix (manual stock edits on Wix)
   - **Order / product webhooks** → full reconcile: sales, catalog content (title/price/photos), new product import
   - **Storefront sales on INW** need `STRIPE_CONNECT_WEBHOOK_SECRET` and `payment_intent.succeeded` on the Connect webhook endpoint
8. **External Install / callback:**
   - Find **OAuth** → **Redirect URLs** or **External install** / **Post-installation URL**.
   - Set to: `https://www.inwcommunity.com/api/channels/wix/callback`
9. **`WIX_REDIRECT_URI` (optional):** Only set in Vercel if you override the default callback.
10. **`WIX_DEFAULT_LOCATION_ID` (optional):** For multi-location sites — location id from Wix Stores settings/API.

### D — Paste into Vercel

| Vercel name | Required? | You copied from Wix |
|-------------|-----------|---------------------|
| `WIX_APP_ID` | Yes | App ID |
| `WIX_APP_SECRET` | Yes | App Secret Key |
| `WIX_REDIRECT_URI` | No | Only if overriding callback |
| `WIX_DEFAULT_LOCATION_ID` | No | Location id |
| `WIX_WEBHOOK_PUBLIC_KEY` | Yes (real-time sync) | Webhooks → Get Public Key |

### D — Tell sellers

- [ ] Their Wix site must have the **Wix Stores** app installed

### D — Classic Editor sites (your setup)

- INW detects your catalog with `GET /stores/v3/provision/version` (**V1_CATALOG** or **V3_CATALOG**) on connect and before sync. **V1** sites use `/stores/v1` + `/stores/v2` only; **V3** sites use `/stores/v3` only. Mixing versions returns **428** (“wrong catalog version”).
- If you see a catalog version error after an update, **disconnect and reconnect Wix** (or run **Test Wix connection** after deploy) so the app refreshes your catalog version.
- **Reads** use Catalog **v1** (`/stores/v1/products/query`) and Inventory **v2** on v1 sites.
- **Writes** (edit qty, delete, update title) use v1/v2 only on v1 sites — never v3 product endpoints.
- If **My Items** shows `Wix: sync error`, open the listing or check Vercel logs — the link stores the API failure message.

### D — Troubleshooting “app not talking to Wix”

| Symptom | What to check |
|---------|----------------|
| **Connect fails** | Vercel has `WIX_APP_ID` + `WIX_APP_SECRET`; redeploy. Wix Dev Center → External install URL = `https://www.inwcommunity.com/api/channels/wix/callback` |
| **Connected but 0 products / no import** | Classic Editor sites use Catalog **v1**; empty v3 responses are normal — reconnect after deploy. In app: open Sync Stores while logged in; API `GET /api/channels/wix/health` should show `productCount` > 0 if Wix has products |
| **Edits in INW don’t change Wix** | Item must be **imported** from Wix (linked listing). My Items shows the Wix error text. Sync Stores → **Test Wix write (qty push)** proves the write API |
| **Delete on INW not on Wix** | Use **Remove listing** (not Mark as sold). Failed delete shows an alert with the Wix error |
| **Wix changes don’t reach INW** | Set `WIX_WEBHOOK_PUBLIC_KEY` + subscribe inventory/product webhooks (see step 7) |
| **Sync issue on card** | Disconnect → Connect Wix again (refreshes `siteId` + token) |
| **INW sale but Wix qty unchanged** | While signed in: `https://www.inwcommunity.com/api/channels/wix/diagnose` — add `?orderId=<id>` or `?repair=1`. If `BASELINE_CORRUPT`, run `?resetBaseline=1` first. If `WIX_METASITE_CONTEXT_ERROR`, Disconnect → Connect Wix. |
| **Qty inflating on its own** | Redeploy latest `main` (cron removed). Fix stock in Seller Hub + Wix admin per size. `?resetBaseline=1` then `?repair=1`. See `CHANNEL-SYNC-RULES.md` anti-pattern section. |

### D — Test in app

1. Sync Stores → **Connect Wix** → install on a test site (existing Wix products auto-import to INW)
2. Create a product on Wix → appears in INW via **product created** webhook or on **Connect Wix** import
3. Edit **price/title/photos** on Wix → INW updates via product webhooks; edit in INW app → Wix updates on **save**
4. Edit **quantity on Wix** → INW updates via **inventory webhooks**
5. Sell on Wix → INW quantity drops; sell on INW → Wix quantity should drop within seconds
6. Wait **5+ minutes** after an INW-only sale → INW quantity should **stay** reduced (not revert)
7. Delete on Wix → INW listing marked sold out; **Remove listing** in INW → deleted on Wix (v1 + v3 delete)

**You're done with Wix when:** Connect works, products mirror both ways, and a test sale on Wix updates INW within minutes (or immediately with webhooks).

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
- [ ] Wix webhooks + `STRIPE_CONNECT_WEBHOOK_SECRET` for event-driven sync (no qty cron)
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
| Wix **Import** fails / “Could not reach store” | **Redeploy**; **disconnect and reconnect** Wix (saves real `siteId`); ensure **Stores product read** + **Manage Your App** permissions |
| New product on **Wix** not in INW | Auto-import on **Connect Wix** + product webhooks; seller needs an active **NWC plan**; price must be &gt; $0 on Wix |
| Shopify “redirect_uri mismatch” | Allowed redirection URL in Partners must match our callback |
| Sales slow to show in INW | Set `WIX_WEBHOOK_PUBLIC_KEY` and subscribe **Order Created** + **Order Approved** |
| INW qty **inflates** or drifts | Redeploy; fix per-size stock; `diagnose?resetBaseline=1`; never write aggregate qty to every Wix variant |
| INW edit doesn’t update Wix | Save listing in app; check **Wix: sync error** on My Items; classic sites use v1/v2 write APIs |
| Wix qty edit slow on INW | Enable all **inventory** webhooks; they pull qty without full catalog reconcile |
| Delete on INW but still on Wix | Redeploy (v1 delete API); confirm Manage Products permission on Wix app |
| Category not matching after import | Remote label may become a **custom** INW category if no preset is similar; edit category in app and save to push taxonomy/collection |
| Options not on Etsy after INW edit | Etsy needs taxonomy properties for the listing category; check **Wix: sync error** / Vercel logs for variant push failure |
| Shopify “too many variants” | Shopify caps at 3 options × 100 variants; reduce option axes in INW |
| Shipping not updating on Etsy | Ensure listing save ran; Etsy uses per-rate shipping profiles (`INW $X.XX`) created on first push |

---

**Workflow in one sentence:** Open the portal link → follow numbered steps → copy keys into the matching Vercel names → redeploy → test in **Seller Hub → Sync Stores**.
