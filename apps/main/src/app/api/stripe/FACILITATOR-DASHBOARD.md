# Where to look in Stripe (LLC vs sellers)

NORTHWEST COMMUNITY LLC is the **platform**. Sellers have **Express Connect** accounts. The LLC dashboard will always show the full storefront charge. That does not mean seller money is yours.

## Platform dashboard (business Stripe)

1. **Payments** — every storefront Checkout charge (items + shipping + tax). This looks like “everyone’s money is in my account.”
2. **Connect → Transfers** (or Payments → Transfers) — seller share leaving the LLC balance. Amount should match `order.totalCents − 1% item reserve − any platform fee` (not tax).
3. **Balances** — should grow by **sales tax + 1% reserve + subscription revenue − Stripe fees**, not by full sale amounts after fulfillment.
4. **Payouts** — money leaving the **LLC** bank (tax remittance, operating, subscriptions). **Not** seller bank payouts.

## Seller money (not on the LLC Payouts tab)

5. **Connect → Accounts → [seller]** — Express balance and payouts to that seller’s bank.
6. Seller **Express dashboard** (Manage Payment Account in Seller Hub) — the seller’s own payout history.
7. In the app: Seller Hub → My Funds → **Total Paid Out** is the sum of `paid` payouts on that Connect account.

## You cannot payout other sellers from the LLC balance

- If a Transfer already ran, seller funds are on their Express account. Use **Send to Bank** (creates a payout **on that Connect account**) or let Stripe’s automatic schedule run.
- If a Transfer never ran, create a **Transfer** to the seller (or refund the buyer). Do not payout seller proceeds from the LLC bank.

## Dedicated tax bank (Terms §7.9.6)

Tax + reserve sit in the same Stripe platform balance as subscriptions until you payout them to a separate bank account. Stripe will not segregate this automatically.

## Reconcile from the repo

From `apps/main`:

```bash
npx tsx scripts/reconcile-storefront-payouts.ts
```

Optional: `LIMIT=20` `MISSING_ONLY=1`. Needs `STRIPE_SECRET_KEY` and database env. Also: Admin → Facilitator Payouts.
