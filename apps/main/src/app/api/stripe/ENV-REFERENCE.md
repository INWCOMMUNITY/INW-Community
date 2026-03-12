# Env variables for Stripe webhooks and storefront

Use this as a checklist. **Do not commit real secrets.** Copy the names into your `.env` (local) or host dashboard (live) and fill in values.

---

## App (local) – `apps/main/.env`

```env
# Database (must match root .env if you use one)
DATABASE_URL="postgresql://..."

# Auth (NEXTAUTH_URL is used for sign-in and post-checkout redirect URLs)
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# Stripe – https://dashboard.stripe.com/apikeys (use Test keys for local)
STRIPE_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."

# Webhooks – from Stripe Dashboard → Developers → Webhooks
# Platform endpoint (same URL for both; use the signing secret from the endpoint you create)
STRIPE_WEBHOOK_SECRET="whsec_..."
# Connect endpoint – create a second endpoint with "Listen to events on connected accounts", then copy its signing secret
STRIPE_CONNECT_WEBHOOK_SECRET="whsec_..."

# Stripe prices (Dashboard → Products → [product] → price ID)
STRIPE_PRICE_SUBSCRIBE="price_..."
STRIPE_PRICE_SPONSOR="price_..."
STRIPE_PRICE_SELLER="price_..."
STRIPE_PRICE_SUBSCRIBE_YEARLY="price_..."
STRIPE_PRICE_SPONSOR_YEARLY="price_..."
STRIPE_PRICE_SELLER_YEARLY="price_..."

# EasyPost (shipping)
EASYPOST_API_KEY=""
ENCRYPTION_KEY="generate-with-openssl-rand-base64-32"

# Resend (tracking emails)
RESEND_API_KEY=""

# Admin
ADMIN_EMAIL="your-admin@example.com"
ADMIN_CODE="your-secret-code"
NEXT_PUBLIC_ADMIN_CODE="same-or-different"
NEXT_PUBLIC_MAIN_SITE_URL="http://localhost:3000"

# Optional
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""
# Address autocomplete (checkout + profile): use one of these (server-side only; not exposed to client)
GOOGLE_PLACES_API_KEY=""
# or GOOGLE_MAPS_API_KEY=""
# Restrict the key in Google Cloud to Places API (Autocomplete + Place Details) and optionally to your server IP.
GIPHY_API_KEY=""
```

**Local webhook testing:** Stripe can’t reach localhost. Use Stripe CLI:  
`stripe listen --forward-to localhost:3000/api/stripe/webhook`  
and use the `whsec_...` it prints for `STRIPE_WEBHOOK_SECRET` (and optionally a second Connect listener for `STRIPE_CONNECT_WEBHOOK_SECRET`).

---

## Live site (production) – host env (e.g. Vercel / Railway)

Set these in your **production** environment (Vercel Project → Settings → Environment Variables, or your host’s equivalent). Use **live** Stripe keys and your real domain.

```env
# Database (production DB URL)
DATABASE_URL="postgresql://..."

# Auth (required for sign-in and redirects)
# NEXTAUTH_URL must be your canonical site URL. If unset, storefront checkout can redirect users to the wrong place after payment. The app falls back to VERCEL_URL when set, but you should set NEXTAUTH_URL in production.
NEXTAUTH_URL="https://www.inwcommunity.com"
NEXTAUTH_SECRET="same-as-or-different-from-local-use-strong-secret"

# Stripe – https://dashboard.stripe.com/apikeys (Live keys)
STRIPE_SECRET_KEY="sk_live_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..."

# Webhooks – create endpoints in Stripe Dashboard (Live mode) with URL:
#   https://www.inwcommunity.com/api/stripe/webhook
# 1) Platform webhook → copy signing secret → STRIPE_WEBHOOK_SECRET
# 2) Connect webhook (same URL, "Listen to events on connected accounts") → copy signing secret → STRIPE_CONNECT_WEBHOOK_SECRET
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_CONNECT_WEBHOOK_SECRET="whsec_..."

# Stripe prices (Live price IDs)
STRIPE_PRICE_SUBSCRIBE="price_..."
STRIPE_PRICE_SPONSOR="price_..."
STRIPE_PRICE_SELLER="price_..."
STRIPE_PRICE_SUBSCRIBE_YEARLY="price_..."
STRIPE_PRICE_SPONSOR_YEARLY="price_..."
STRIPE_PRICE_SELLER_YEARLY="price_..."

# EasyPost / Resend / Admin – use production values
EASYPOST_API_KEY=""
ENCRYPTION_KEY=""
RESEND_API_KEY=""
ADMIN_EMAIL="..."
ADMIN_CODE="..."
NEXT_PUBLIC_ADMIN_CODE="..."
NEXT_PUBLIC_MAIN_SITE_URL="https://www.inwcommunity.com"

# Optional
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""
# Address autocomplete: GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY (server-side; see App section)
GIPHY_API_KEY=""
```

**Live webhook URL:**  
`https://www.inwcommunity.com/api/stripe/webhook`  

Create **two** endpoints in Stripe (Live) if you use both platform and Connect events: one normal, one with “Listen to events on connected accounts.” Each has its own signing secret.
