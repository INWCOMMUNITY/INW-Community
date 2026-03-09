# Stripe Connect Webhooks: Ensuring Payments Go to Sellers

When adding or changing webhooks for marketplace payments, use these safeguards so **funds go to the seller’s Connect account**, not the platform.

## 1. Create charges on the connected account

- **PaymentIntents** for seller orders must be created with `{ stripeAccount: connectAccountId }` (seller’s `stripeConnectAccountId`).
- Do **not** create PaymentIntents on the platform account for marketplace item sales; that would route funds to you.
- See: `storefront-checkout-intent/route.ts` — it uses `stripeAccount: connectAccountId` when creating each seller’s PaymentIntent.

## 2. Use the Connect webhook endpoint for Connect events

- In Stripe Dashboard, configure a **second** webhook endpoint for **“Events on connected accounts”** (Connect webhook).
- Use `STRIPE_CONNECT_WEBHOOK_SECRET` for that endpoint.
- Connect events include a top-level `account` field (the connected account id). Use it to know which seller received the payment.

## 3. In the webhook handler

- **Identify Connect vs platform:**  
  `const isConnectEvent = Boolean((event as { account?: string }).account);`
- **For `payment_intent.succeeded` (store orders):**
  - Only treat as a seller payment when `event.account` is present (Connect event).
  - **Validate account:** Confirm `event.account === order.seller.stripeConnectAccountId` before updating the order. Reject or skip if they don’t match so you never credit the wrong seller or platform.
  - **Idempotency:** Skip processing if the order is already `paid` with the same `stripePaymentIntentId` (avoid double-processing on retries).
- **Do not credit platform balance for Connect payments:**  
  Seller balance / platform fee logic should run only when `!isConnectEvent` (platform Checkout), not for Connect `payment_intent.succeeded` events. For Connect, funds are already in the seller’s Stripe account.

## 4. Metadata

- Attach `orderId` (and if needed `orderIds`) on the PaymentIntent so the webhook can find the order and seller.
- Never trust amount or seller from the event alone; always resolve the order from your DB and validate the Connect account.

## 5. Dashboard checklist for a new Connect webhook

- [ ] Endpoint URL points to your webhook route (e.g. `/api/stripe/webhook`).
- [ ] “Listen to events on connected accounts” is enabled.
- [ ] Events include: `payment_intent.succeeded`, `account.application.deauthorized` (and any others you need).
- [ ] Signing secret is stored in `STRIPE_CONNECT_WEBHOOK_SECRET` and the handler verifies the Connect secret when `event.account` is present.
