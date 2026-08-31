# Storefront Operations: Who Gets What (Platform vs Seller)

Plain-language review of how the storefront works and what is credited to you (platform) vs the seller.

---

## 1. Listing items (product listing)

- **Who owns the listing?** The **seller**. Each `StoreItem` has `memberId` = the seller. The listing is always credited to that member (the seller), not the platform.
- **Who can create?** Only a logged-in user with Seller or Subscribe plan. New (storefront) items require Seller plan; resale items require Subscribe or Seller.
- **Requirements before listing:** Seller must complete **Stripe Connect** (payment account). If the item offers shipping (not “local delivery/pickup only”), the seller must connect **Shippo** (shipping) in Seller Hub.
- **Platform’s role:** You host the listing and enforce rules (Stripe/Shippo required, content checks). You do not “own” or get credited for the product; the seller does.

---

## 2. Editing and deleting items

- **Who can edit or delete?** The **seller** who owns the item, or an **admin**. The API allows PATCH/DELETE when `existing.memberId === session.user.id` or when the request is authenticated as admin (`requireAdmin`).
- **Delete:** Row is removed from the DB. No money or “credit” moves; it’s just the seller or admin removing the listing.

---

## 3. Quantity

- **Who sets it?** The **seller** when creating or editing the listing (single quantity or variant options with per-option quantities).
- **Who updates it when someone buys?** The **system** (your backend):
  - When a payment succeeds (Stripe webhook `payment_intent.succeeded` or checkout completion) or when a **cash** order is created (pickup/local delivery), quantity is decremented (and variants if used). When quantity hits 0, the item is marked `sold_out`.
  - On **refund**, quantity (and variants) are incremented back.
- So: seller sets quantity; your app is the only one that decrements/increments it on sale/refund.

---

## 4. Payments (who gets the money)

**Website and app work the same way:** hosted Checkout on the **platform** (marketplace facilitator), then a Connect Transfer to the seller.

- Both **website** and **mobile** call `POST /api/stripe/storefront-checkout`, which creates a Checkout Session on the NORTHWEST COMMUNITY LLC Stripe account with Stripe Tax enabled.
- The **full charge** (items + shipping + tax) lands on the platform. That is why the LLC Payments tab shows the sale.
- On `checkout.session.completed`, the app transfers the seller share to their Express Connect account. **Sales tax** and the **1% Sales Tax Reserve** stay on the platform for remittance (Terms §7.9).
- `POST /api/stripe/storefront-checkout-intent` is retired (410). It charged the seller Connect account directly and skipped facilitator tax.

---

## 5. Shipping (labels and who pays)

- **Who pays for the shipping label?** The **seller**. Labels are bought with the **seller’s Shippo account** (they connect it in Seller Hub). The API says: “You pay for labels with your own card.”
- **Who receives the shipping money from the buyer?** The **seller**. Shipping is part of the pre-tax order total and is included in the Connect Transfer (minus the 1% reserve on item subtotal only).
- **Platform’s role:** You don’t pay for labels. You briefly collect the charge, then transfer the seller share (including shipping). Tax stays with you.

---

## 6. Refunds

- Card refunds run on the **platform** PaymentIntent (`refund-store-order.ts`) and **reverse the Connect Transfer** so seller money comes back before the buyer is refunded.
- The internal seller ledger is debited by the same amount that was transferred (not a hardcoded 5% fee).
- Inventory is restored. Cash (pay-in-person) orders have no Stripe refund.

---

## 7. Cash orders (pickup / local delivery)

- Buyer chooses “pay in person” (cash) for pickup or local delivery only. No Stripe charge.
- An order is created with status `paid`; inventory is decremented (and `sold_out` when quantity hits 0). **No money flows through you or Stripe**; the seller and buyer settle in person.

---

## 8. Summary table

| What                    | Credited to / Paid by |
|-------------------------|------------------------|
| Product listing         | Seller (owner of listing) |
| Edit/delete listing     | Seller only            |
| Quantity                | Set by seller; updated by system on sale/refund |
| Mobile card payment     | Charge on **platform**; seller share **Transferred** to Connect; tax + 1% reserve stay on LLC |
| Website card payment    | Same as mobile |
| Shipping label purchase | **Seller** (their Shippo) |
| Card refund             | **Platform** refund + Connect transfer reversal |
| Cash orders             | No platform; seller and buyer in person |

---

## 9. Retired Connect-direct checkout

- `storefront-checkout-intent` (PaymentIntent on the seller Connect account) is **retired** and returns HTTP 410. Do not use it; tax would go to the seller instead of the LLC.
