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
   - `customer.subscription.created`
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

Update **`apps/mobile/.env`** for payment sheet and checkout redirects:

```env
# Base URL of your API (main site). Required for Stripe redirects.
# Physical device: use your computer's IP (e.g. http://192.168.1.140:3000)
# Production: https://your-domain.com
EXPO_PUBLIC_API_URL=http://localhost:3000

# Must match NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY from apps/main
# Use pk_test_... for test mode, pk_live_... for production
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- **EXPO_PUBLIC_API_URL**: Used for API calls and as `returnBaseUrl` for Stripe Checkout redirects. When testing on a physical device, use your machine's local IP (not `localhost`) so the WebView can load the order-success page after payment.
- **EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY**: Required for the native Payment Sheet. Must match the main app. Copy from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys).

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

## Testing with Development Build

The native Stripe Payment Sheet (`@stripe/stripe-react-native`) does not work in Expo Go. To test checkout with native in-app payment, use a **development build**. In Expo Go, Stripe checkout uses an in-app WebView (no external browser).

### Prerequisites

- **Xcode** installed (Mac)
- **Apple Developer account** (for code signing)
- **Main app running**: `pnpm run dev` in monorepo root or `apps/main`
- **Stripe CLI** for local webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- **Physical device**: Set `EXPO_PUBLIC_API_URL` to your machine's IP (e.g. `http://192.168.1.140:3000`), not `localhost`, so WebView redirects work

### Option A: EAS Build (recommended)

1. Install EAS CLI: `npm install -g eas-cli`
2. Log in: `eas login`
3. Build: `cd apps/mobile && eas build --profile development --platform ios`
4. When prompted, configure your Apple Developer account credentials (or run `eas credentials` first)
5. Install the build on your device via the QR code or link from the build output
6. Start Expo: `cd apps/mobile && npx expo start` and connect the dev build to your dev server

### Option B: Local build with Xcode

1. Ensure Xcode and your Apple Developer account are set up
2. Run: `cd apps/mobile && npx expo run:ios`
3. Sign in with your Apple Developer account when Xcode prompts for code signing
4. App runs in the simulator or on a connected device

### Configuration checklist

- **eas.json**: `development` profile has `developmentClient: true` and `distribution: "internal"`
- **app.json**: `bundleIdentifier` is `Northwestcommunity` (or your App ID)
- **apps/mobile/.env**: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` matches main app; `EXPO_PUBLIC_API_URL` is your machine's IP for device testing

### Verification steps

1. Run the dev build (EAS or `expo run:ios`).
2. **Subscription checkout**: Sign up as Business or Seller → complete business form → contact → checkout. In a dev build, the native Payment Sheet should appear. In Expo Go, "Pay with card" opens an in-app WebView.
3. **Test card**: Use `4242 4242 4242 4242`, any future expiry, any CVC.
4. **Post-checkout**: Confirm redirect to My Community and that `member.subscriptionPlan` is correct.
5. **Storefront**: Add item to cart → checkout → confirm in-app WebView completes and shows order-success.
6. **Stripe Connect**: As a seller, go to Seller Hub → Before You Start or My Items → "Set up Stripe payments". Flow opens in an in-app WebView and returns to the app on success.
7. **Billing Portal**: As a subscriber, go to My Community → "Manage Subscription". Stripe Billing Portal opens in-app; after updating or canceling, returns to My Community.

---

## Troubleshooting (App)

### Subscriptions not working in app

- **Expo Go**: Native Payment Sheet does not work in Expo Go. The app uses an in-app WebView for checkout (no external browser). Use a development build for native Payment Sheet.
- **Stripe not configured**: Ensure `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set and not a placeholder. Restart Expo after changing `.env`.
- **Sign in required**: Subscriptions require a logged-in user. If you see "Unauthorized" or "Sign in required", sign in first.

### Storefront checkout redirect fails on physical device

- Set `EXPO_PUBLIC_API_URL` to your computer's IP (e.g. `http://192.168.1.140:3000`), not `localhost`. The app passes this as `returnBaseUrl` so Stripe redirects to a URL the device can reach.
- Ensure the main site is running and reachable from the device (same WiFi).

### Payment Sheet fails to load

- Verify `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` matches `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `apps/main/.env`.
- In Expo Go, the native module is unavailable; use the "Pay with card" in-app WebView fallback.

---

## Troubleshooting (Live Site / Production)

### Checkout from NWC Services (/support-nwc) not redirecting

1. **Sign in first**: The Subscribe/Sponsor/Seller buttons require you to be signed in. If not signed in, you'll be redirected to login. After signing in, you'll return to support-nwc—click the plan button again to go to checkout.
2. **Environment variables**: In Vercel (or your host), ensure all Stripe variables are set:
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_SUBSCRIBE`, `STRIPE_PRICE_SPONSOR`, `STRIPE_PRICE_SELLER`
   - Yearly plans: `STRIPE_PRICE_SUBSCRIBE_YEARLY`, etc. if you use yearly billing
3. **NEXTAUTH_URL**: Must exactly match your live site URL (e.g. `https://inwcommunity.com`). No trailing slash. If using `www`, include it. Mismatch can cause session/cookie issues.
4. **Error message**: If the button shows an error (red text), that indicates the API response—e.g. "Invalid plan or Stripe not configured" means price IDs are missing.

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
