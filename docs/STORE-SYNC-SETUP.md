# Store Sync — Your Go-Live Checklist

This guide is for **you** (not the code). It tells you exactly what to click, copy, and paste so **Sync Stores** works in the real app — for **Etsy**, **eBay**, **Wix**, and **Shopify**.

The app code is already built. You just need to:
1. Sign up for each marketplace’s “developer” account (where they give you keys).
2. Paste those keys into **Vercel**.
3. **Deploy** once.
4. Try connecting a test shop and buying/selling something to make sure it works.

**Good order:** Do the **Shared** steps first, then one store at a time (Etsy → eBay → Wix → Shopify is fine).

---

## Part A — Shared setup (do this once for everything)

These steps help **all four** stores work together.

### Step A1 — Check you already have three secrets in Vercel

Open **Vercel → your main app → Settings → Environment Variables**.

You should **already** have these. **Do not add them again** unless they’re missing:

| Name | What it does (simple) |
|------|------------------------|
| `ENCRYPTION_KEY` | Locks up marketplace passwords/tokens so nobody can read them in the database. |
| `CRON_SECRET` | Lets only Vercel run the “check for sales every 15 minutes” job. |
| `NEXTAUTH_SECRET` | Keeps the “Connect store” login flow safe. |

If any are missing, fix that before you connect Etsy/eBay/Wix/Shopify.

---

### Step A2 — Make sure the database is updated

When you deploy, your server should run **database migrations** automatically.

**What you’re checking for:** After deploy, your production database should have these **three new tables**:
- `channel_connection`
- `channel_listing_link`
- `channel_sync_event`

**If you deploy by hand** (not sure migrations run), run this on your computer:

```bash
cd packages/database
npx prisma migrate deploy
```

The migrations live in:
- `packages/database/prisma/migrations/20260601180000_channel_sync/`
- `packages/database/prisma/migrations/20260601193000_ebay_channel/`

---

### Step A3 — Turn on the “every 15 minutes” sales checker

The app checks all connected stores for new sales **every 15 minutes**. That’s the backup if a webhook doesn’t fire.

1. Deploy the main app (so `apps/main/vercel.json` is live).
2. Go to **Vercel → your main app → Cron Jobs**.
3. You should see: **`GET /api/cron/sync-channels`** — runs **every 15 minutes**.
4. It uses `CRON_SECRET` (from Step A1). You don’t need to add anything else for the cron.

---

### Step A4 — After you add ANY new keys in Vercel

**Always redeploy** the main app. New environment variables don’t work until the app restarts with them.

---

### Step A5 — Legal stuff (Terms & Privacy)

Someone should **read** the updated Terms and Privacy (marketplace sync sections):
- Terms: `apps/main/src/lib/terms-content.ts`
- Privacy: `apps/main/src/lib/privacy-content.ts`

If you give users PDF versions, re-export them:

```bash
# from repo root, if you use the export script
scripts/export-policy-pdfs.ts
```

---

## Part B — Etsy

### Step B1 — Make an Etsy “developer app”

1. Open: https://www.etsy.com/developers/your-apps  
2. Click to **create a new app**.  
3. Ask Etsy for **Commercial / production access** (you need this so lots of sellers can connect — not just you). **This can take a few days**, so do it early.  
4. Etsy will give you two important things:
   - **Keystring** → you’ll paste this as `ETSY_API_KEY` (it’s also the OAuth “client id”).
   - **Shared secret** → you’ll paste this as `ETSY_CLIENT_SECRET`.  
5. Tell Etsy your **callback URL** (where Etsy sends the seller back after they log in):
   - **Production:** `https://www.inwcommunity.com/api/channels/etsy/callback`
   - **Optional for testing on your laptop:** `http://localhost:3000/api/channels/etsy/callback`  
6. Make sure your app is allowed to use these permissions (the code already asks for them):  
   `listings_r`, `listings_w`, `transactions_r`, `shops_r`

---

### Step B2 — Paste Etsy keys into Vercel

Go to **Vercel → main app → Settings → Environment Variables** (Production; add Preview too if you test there). Also copy the same values into your local `.env` if you develop locally.

| Paste this name | Required? | What to put in the box |
|-----------------|-----------|-------------------------|
| `ETSY_API_KEY` | **Yes** | The **keystring** from Etsy. |
| `ETSY_CLIENT_SECRET` | **Yes** | The **shared secret** from Etsy. |
| `ETSY_REDIRECT_URI` | **Yes** | Must be **exactly** the callback URL from Step B1, e.g. `https://www.inwcommunity.com/api/channels/etsy/callback` |
| `ETSY_CLIENT_ID` | No | Only if Etsy gave you a *different* client id than the keystring. Usually leave blank. |
| `ETSY_WEBHOOK_SECRET` | No | Only if you set up webhooks (Step B4). |
| `ETSY_DEFAULT_TAXONOMY_ID` | No | A default Etsy category number if a listing has no category. If blank, the app uses `1`. |

Then **redeploy** (Part A, Step A4).

---

### Step B3 — Tell Etsy sellers one rule

For a listing to go **live** on Etsy (not stuck as a **draft**), the seller needs at least one **shipping profile** on their Etsy shop.

- The app picks the first shipping profile when they connect.
- If they have none, the Sync Stores screen shows a warning, and new Etsy listings stay as drafts until they add one.

---

### Step B4 — Etsy webhooks (optional — faster sales updates)

**You can skip this.** Sales still sync every ~15 minutes from the cron.

If you want sales to show up **faster**:

1. In Etsy’s app settings, send order/receipt events to:  
   `https://www.inwcommunity.com/api/channels/etsy/webhook`
2. Copy Etsy’s **signing secret** into Vercel as `ETSY_WEBHOOK_SECRET`.
3. Redeploy.

---

### Step B5 — Test Etsy (do this once after deploy)

Use the mobile app like a real seller:

1. **Seller Hub → Sync Stores → Connect Etsy** — log in on Etsy’s website — you should see “Connected to &lt;shop name&gt;”.
2. **Import** — tap **Import existing listings**, pick one, import it — it should show in **My Items** with an Etsy sync badge.
3. **Create** — make a new item on INW with “list on Etsy too” on — check Etsy (live or draft depends on shipping profile).
4. **Edit** — change title, price, or quantity on INW — check Etsy updated.
5. **Sell on Etsy** — buy/sell that item on Etsy — within ~15 min (or right away with webhooks) INW quantity should drop; other connected stores should update too.
6. **Sell on INW** — buy the item in INW — Etsy quantity should drop.
7. **Disconnect** — syncing should stop; the listing should **stay** on Etsy.

---

## Part C — eBay

**Important:** eBay connect is **production only**. There is no sandbox switch in our app.

Sales are detected by the **15-minute cron** (no eBay webhook in v1).

---

### Step C1 — Make an eBay developer app (production)

1. Open: https://developer.ebay.com/my/keys  
2. Create a **Production** keyset (not sandbox).  
3. Copy:
   - **App ID (Client ID)** → `EBAY_CLIENT_ID`
   - **Cert ID (Client Secret)** → `EBAY_CLIENT_SECRET`  
4. Go to **User tokens (OAuth)** and create an **RuName** (Redirect URL name).  
5. For the RuName, set **“Your auth accepted URL”** to:  
   `https://www.inwcommunity.com/api/channels/ebay/callback`  
6. Copy the **RuName string** itself (NOT the URL). It looks like:  
   `Your_Company-Your_App-PRD-xxxxxxxxx-xxxxxxxx`  
   That string is `EBAY_RUNAME`.  
7. Your keyset must allow these scopes:  
   `sell.inventory`, `sell.account`, `sell.fulfillment`, `commerce.identity.readonly`

---

### Step C2 — Paste eBay keys into Vercel

| Paste this name | Required? | What to put in the box |
|-----------------|-----------|-------------------------|
| `EBAY_CLIENT_ID` | **Yes** | App ID (Client ID) from production keyset. |
| `EBAY_CLIENT_SECRET` | **Yes** | Cert ID (Client Secret). |
| `EBAY_RUNAME` | **Yes** | The RuName **string** from Step C1. |
| `EBAY_DEFAULT_CATEGORY_ID` | No | Default eBay category if a listing has no category. Sellers can also pick per item in the app. |

Redeploy.

---

### Step C3 — Tell eBay sellers what they need on eBay

To publish **live** on eBay (not just a draft), the seller needs on their eBay account:

1. **Business Policies** turned on (Seller Hub → Account → Business Policies):
   - a payment policy  
   - a return policy  
   - a shipping/fulfillment policy  
2. At least one **merchant location** (where inventory “lives”).

When they connect, we save the first policy and location we find. If something is missing, the app shows a warning and listings stay **unpublished** until they fix it and re-save the item (or reconnect).

---

### Step C4 — Test eBay

1. **Seller Hub → Sync Stores → Connect eBay** — finish login — “Connected to &lt;username&gt;”.
2. Fix the warning if you see it (policies + location on eBay), then reconnect or re-save an item.
3. **Import** — import one listing. (Old-style listings get migrated to eBay’s newer inventory system; some listings might be skipped with a reason shown in the app.)
4. **Create/edit** on INW — check eBay (published if policies exist, otherwise draft).
5. **Sell on eBay** — within ~15 min, INW quantity drops and other stores update.
6. **Sell on INW** — eBay quantity drops.

**Heads-up:** Some eBay categories need extra “item details” fields. If eBay requires them and we don’t have them, the listing may stay unpublished and the app will show the error (like Etsy drafts).

---

## Part D — Wix

Wix works differently: each seller **installs your Wix app** on their site. We don’t store a long-lived “refresh token” — we use the site’s `instanceId` plus your app secret to get short-lived tokens.

Sales are detected by the **15-minute cron** (no Wix webhook in v1).

---

### Step D1 — Make a Wix app

1. Open: https://dev.wix.com  
2. **Build an App** (create a new app).  
3. In the app’s **OAuth** section, copy:
   - **App ID** → `WIX_APP_ID`
   - **App Secret Key** → `WIX_APP_SECRET`  
4. Add **Permissions** (what the app is allowed to do):
   - **Wix Stores** — manage products and inventory  
   - **Wix eCommerce** — read orders (so we know when something sold)  
   - *(Optional)* **Site Properties** — read (nice shop name in the app)  
5. Set up **External Install Flow**. The callback URL must be:  
   `https://www.inwcommunity.com/api/channels/wix/callback`  
   After a seller installs, Wix sends them back here with an `instanceId` — that’s how we know which site to talk to.

**Later (optional):** Add webhooks for “order created” and “app removed” for faster updates. Not required for launch.

---

### Step D2 — Paste Wix keys into Vercel

| Paste this name | Required? | What to put in the box |
|-----------------|-----------|-------------------------|
| `WIX_APP_ID` | **Yes** | App ID from Wix. |
| `WIX_APP_SECRET` | **Yes** | App Secret Key from Wix. |
| `WIX_REDIRECT_URI` | No | Only if you need to override the callback URL. Default is `{your site}/api/channels/wix/callback`. |
| `WIX_DEFAULT_LOCATION_ID` | No | Only if the site has many inventory locations and you want to force one. |

Redeploy.

---

### Step D3 — Tell Wix sellers one rule

Their Wix site must have the **Wix Stores** app installed. Without it, we can’t create products. The Sync Stores screen reminds them.

---

### Step D4 — Test Wix

1. **Connect Wix** — install the app on a test site — you should see “Connected”.
2. **Import** one product — shows in My Items linked to Wix.
3. **Create/edit** on INW — product shows/updates on the Wix site.
4. **Sell on Wix** — within ~15 min, INW quantity drops.
5. **Sell on INW** — Wix quantity drops.
6. **Disconnect** — Wix products stay; syncing stops.

**v1 limits:** One variant per product (no fancy option-matrix sync yet). Pictures come from URLs (best effort). Sales = cron only for now.

---

## Part E — Shopify

Each seller connects **their own** shop (`something.myshopify.com`). Sales are detected by the **15-minute cron** (no Shopify webhook in v1).

---

### Step E1 — Make a Shopify Partner app

1. Open: https://partners.shopify.com  
2. **Apps → Create app**.  
3. Under **Configuration**, add **Allowed redirection URL(s)**:
   - **Production:** `https://www.inwcommunity.com/api/channels/shopify/callback`
   - **Optional local:** `http://localhost:3000/api/channels/shopify/callback`  
4. Under **Client credentials**, copy:
   - **Client ID** → `SHOPIFY_API_KEY`
   - **Client secret** → `SHOPIFY_API_SECRET`  
5. Request these **Admin API scopes**:
   - `read_products`, `write_products`
   - `read_inventory`, `write_inventory`
   - `read_orders`  
6. If lots of random merchants will install your app, plan for **Shopify’s app review** process.

---

### Step E2 — Paste Shopify keys into Vercel

| Paste this name | Required? | What to put in the box |
|-----------------|-----------|-------------------------|
| `SHOPIFY_API_KEY` | **Yes** | Client ID from Partner dashboard. |
| `SHOPIFY_API_SECRET` | **Yes** | Client secret. |
| `SHOPIFY_API_VERSION` | No | API version; default is `2024-10`. |
| `SHOPIFY_REDIRECT_URI` | No | Only to override callback; default is `{your site}/api/channels/shopify/callback`. |
| `SHOPIFY_DEFAULT_LOCATION_ID` | No | For shops with many warehouse locations. |

Redeploy.

---

### Step E3 — Tell Shopify sellers what to do in the app

Before they tap **Connect Shopify**, they type their shop name:
- `mystore` **or** `mystore.myshopify.com`

Their store needs:
- **Online Store** channel  
- **Inventory tracking** turned on for products  

One Shopify shop per INW account (same rule as other marketplaces).

---

### Step E4 — Test Shopify

1. Enter shop domain → **Connect Shopify** → approve in Shopify → “Connected”.
2. **Import** one product.
3. **Create/edit** on INW — check Shopify product and quantity.
4. **Sell on Shopify** — within ~15 min, INW quantity drops.
5. **Sell on INW** — Shopify inventory drops.
6. **Disconnect** — Shopify products stay; syncing stops.

**v1 limits:** One variant per product. Cron-only sales. Images from URLs (best effort). Multi-location shops: set `SHOPIFY_DEFAULT_LOCATION_ID` if needed.

---

## Cheat sheet — copy into Vercel

Fill in the `=` parts after you create each app. **Don’t** re-add `ENCRYPTION_KEY`, `CRON_SECRET`, or `NEXTAUTH_SECRET` if you already have them.

```
# Etsy
ETSY_API_KEY=
ETSY_CLIENT_SECRET=
ETSY_REDIRECT_URI=https://www.inwcommunity.com/api/channels/etsy/callback

# eBay (production only)
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_RUNAME=

# Wix
WIX_APP_ID=
WIX_APP_SECRET=
WIX_REDIRECT_URI=https://www.inwcommunity.com/api/channels/wix/callback

# Shopify
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_REDIRECT_URI=https://www.inwcommunity.com/api/channels/shopify/callback
```

**Optional extras** (only if you need them):

```
ETSY_CLIENT_ID=
ETSY_WEBHOOK_SECRET=
ETSY_DEFAULT_TAXONOMY_ID=

EBAY_DEFAULT_CATEGORY_ID=

WIX_DEFAULT_LOCATION_ID=

SHOPIFY_API_VERSION=
SHOPIFY_DEFAULT_LOCATION_ID=
```

---

## Quick recap (the whole journey)

| # | What you do |
|---|-------------|
| 1 | Confirm `ENCRYPTION_KEY`, `CRON_SECRET`, `NEXTAUTH_SECRET` exist in Vercel. |
| 2 | Deploy so database migrations + 15-min cron are live. |
| 3 | For each store: sign up as developer → copy keys → paste in Vercel → **redeploy**. |
| 4 | Tell sellers the simple rules (shipping profile, eBay policies, Wix Stores app, Shopify domain). |
| 5 | Connect a test shop in the app and run through import → edit → sell both ways → disconnect. |
| 6 | Review Terms/Privacy; export PDFs if you use them. |

That’s it. The code does the hard part — you’re just handing it the keys and checking that it works once.
