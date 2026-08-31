# Stripe Connect Webhooks: Marketplace Facilitator

Storefront card sales use **hosted Checkout on the platform** (NORTHWEST COMMUNITY LLC) so Stripe Tax can run. Seller proceeds are sent afterward with a **Connect Transfer**. Do **not** create PaymentIntents on the seller’s Connect account for new storefront sales.

## 1. Charge on the platform, transfer the seller share

- Live path: `POST /api/stripe/storefront-checkout` → `checkout.sessions.create` with `automatic_tax: { enabled: true }`.
- On `checkout.session.completed`, `fulfillStoreOrdersFromCheckoutSession` creates `stripe.transfers.create` to the seller’s Express account (`source_transaction` = the charge).
- **Stays on the platform balance:** Stripe Tax + the 1% Sales Tax Reserve (+ optional `NWC_MARKETPLACE_PLATFORM_FEE_*`).
- **Goes to Connect:** `order.totalCents - platformFee - salesTaxReserve` (pre-tax; tax is never transferred).
- Retired: `POST /api/stripe/storefront-checkout-intent` returns **410**. It charged the seller Connect account and skipped facilitator tax.

## 2. Webhook endpoints

- **Platform webhook** (`STRIPE_WEBHOOK_SECRET`): `checkout.session.completed` (and subscription events). This is what fulfills storefront orders and creates Transfers.
- **Connect webhook** (`STRIPE_CONNECT_WEBHOOK_SECRET`): events on connected accounts. Needed for Express account disconnect (`account.application.deauthorized`) and seller bank payouts (`payout.paid` / `payout.failed`).
- Thin destinations (`STRIPE_THIN_WEBHOOK_SECRET`) if you use v2 event destinations.

## 3. Handler rules

- Identify Connect vs platform: `const isConnectEvent = Boolean(event.account)`.
- Store orders: fulfill on **platform** `checkout.session.completed` only. Do not mark a platform `payment_intent.succeeded` as paid — that skips the Transfer.
- Legacy Connect `payment_intent.succeeded` (old checkout-intent orders) still updates inventory when `event.account` matches the seller’s Connect id.
- Idempotency: skip if the order is already `paid` with the same `stripePaymentIntentId`.

## 4. Metadata

- Put `orderIds` (or chunked `orderIds_0`…) on the **Checkout Session**.
- Resolve the order from the DB; do not trust amount or seller from the event alone.

## 5. Dashboard checklist

- [ ] Platform endpoint at `/api/stripe/webhook` listens for `checkout.session.completed`.
- [ ] Connect endpoint at the same URL listens for events on connected accounts (`payout.paid`, `account.application.deauthorized`).
- [ ] Signing secrets match `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` (live vs test).
- [ ] LLC **Payouts** tab = platform bank payouts (tax remittance, subscriptions). Seller bank payouts are on each Express account (Connect → Accounts, or the seller Express dashboard).

See also `FACILITATOR-DASHBOARD.md` in this folder.
