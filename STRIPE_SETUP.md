# Stripe Setup – Finish Connecting & Accept Payments

This guide walks you through completing your Stripe integration so you can customize checkout and accept payments.

## Current Status

Your app already has:

- ✅ API keys configured in `apps/main/.env` (STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
- ✅ Checkout flows for subscriptions (subscribe/sponsor/seller) and storefront
- ✅ Webhook handler at `/api/stripe/webhook`

You still need to:

1. Create subscription products/prices in Stripe
2. Configure a webhook endpoint and get the signing secret
3. Add the price IDs and webhook secret to your environment
4. (Optional) Customize checkout appearance

---

## Step 1: Create Subscription Products & Prices

1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Click **Add product** and create three products:

| Product Name        | Monthly       | Yearly (optional) | Notes                             |
|---------------------|---------------|-------------------|-----------------------------------|
| Northwest Subscribe | $10/mo        | e.g. $100/year    | Basic subscription                |
| Northwest Sponsor   | $25/mo        | e.g. $250/year    | Sponsors get a business listing   |
| Northwest Seller    | $40/mo        | e.g. $400/year    | Sellers get storefront + Connect  |

3. For each product:
   - Add the product name
   - Add a **Recurring** price (monthly) – required
   - Optionally add a **Recurring** price (yearly) – customers can then choose monthly or yearly on the support page
   - Save and copy the **Price ID** for each price (starts with `price_`)

---

## Step 2: Set Up the Webhook

Stripe needs to notify your app when payments succeed. Configure a webhook endpoint:

### Production (deployed app)

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. **Endpoint URL**: `https://your-domain.com/api/stripe/webhook`
   - Replace `your-domain.com` with your production domain (e.g. Vercel URL)
4. **Listen to**: Select these events:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `invoice.payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**
6. Open the new endpoint and click **Reveal** under *Signing secret* → copy the value (starts with `whsec_`)

### Local development (Stripe CLI)

1. [Install Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Run:
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
3. The CLI prints a webhook signing secret like `whsec_...` — use that in your local `.env`

---

## Step 3: Update Environment Variables

Update **`apps/main/.env`** (and root `.env` if used):

```env
# From Step 1 – your Price IDs (monthly, required)
STRIPE_PRICE_SUBSCRIBE="price_xxxxxxxxxxxx"
STRIPE_PRICE_SPONSOR="price_xxxxxxxxxxxx"
STRIPE_PRICE_SELLER="price_xxxxxxxxxxxx"

# Optional – yearly prices (enables Monthly/Yearly toggle on support page)
# STRIPE_PRICE_SUBSCRIBE_YEARLY="price_xxxxxxxxxxxx"
# STRIPE_PRICE_SPONSOR_YEARLY="price_xxxxxxxxxxxx"
# STRIPE_PRICE_SELLER_YEARLY="price_xxxxxxxxxxxx"

# From Step 2 – webhook signing secret
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxx"
```

Update **`apps/mobile/.env`** so the app can show the payment sheet:

```env
# Must match NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY from apps/main
# Use pk_test_... for test mode, pk_live_... for production
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Copy the publishable key from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys). The mobile key must match the main app: use test keys for development, live keys for production.

---

## Step 4: Customize Checkout Appearance (Optional)

You can customize Stripe Checkout in two ways:

### Option A: Stripe Dashboard (global, easiest)

1. Go to [Stripe Dashboard → Settings → Branding](https://dashboard.stripe.com/settings/branding)
2. Set:
   - **Business name**: e.g. `Northwest Community`
   - **Icon/logo**: Upload your logo
   - **Brand color**: e.g. `#505542` (primary color)
   - **Background color** (optional)

### Option B: Per-session branding (env vars)

Add these optional variables to `apps/main/.env` to override per session:

```env
STRIPE_CHECKOUT_DISPLAY_NAME="Northwest Community"
STRIPE_CHECKOUT_BUTTON_COLOR="#505542"
STRIPE_CHECKOUT_BACKGROUND_COLOR="#ffffff"
```

Restart your dev server after any env changes.

---

## Verify Setup

1. Restart the main dev server: `pnpm run dev` (in `apps/main` or root)
2. **Subscriptions**: Go to `/support-nwc` and start checkout for a plan
3. **Storefront**: Add an item to cart and complete checkout
4. **Mobile**: In the app, try a subscription or store purchase

Use [Stripe test cards](https://docs.stripe.com/testing#cards) (e.g. `4242 4242 4242 4242`) when in test mode.

---

## Deployment (Vercel)

Add all Stripe variables to your Vercel project:

- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_SUBSCRIBE`
- `STRIPE_PRICE_SPONSOR`
- `STRIPE_PRICE_SELLER`

Create the webhook for your production URL (Step 2) and use the **live** signing secret in Vercel env vars.
