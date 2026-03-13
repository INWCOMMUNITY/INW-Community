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

**Website and app work the same way:** card payments use **Stripe Connect** only.

- Both **website** and **mobile** call `storefront-checkout-intent`, which creates PaymentIntents **on each seller’s Connect account** (`stripeAccount: connectAccountId`).
- **Money goes to the seller’s Stripe account**, not the platform. Buyers pay; Stripe sends funds to the seller. You do not receive the payment.
- The webhook receives **Connect** `payment_intent.succeeded` (`event.account` set). Your code does **not** credit platform or internal seller balance; it only updates order status, inventory, and notifications.

**Requirement:** The website needs `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set so the embedded checkout page can confirm payment. If it’s missing, the site shows a message that card payment is not configured instead of falling back to a different flow.

---

## 5. Shipping (labels and who pays)

- **Who pays for the shipping label?** The **seller**. Labels are bought with the **seller’s Shippo account** (they connect it in Seller Hub). The API says: “You pay for labels with your own card.”
- **Who receives the shipping money from the buyer?** The **seller**. Shipping is part of the order total and goes to the seller’s Connect account (website and app use the same Connect flow).
- **Platform’s role:** You don’t pay for labels and you don’t receive shipping funds; the seller receives everything in their Stripe Connect account.

---

## 6. Refunds

- **If the order was paid with Connect (seller’s Stripe):** Refund is created **on the seller’s Connect account** (`stripeAccount: connectAccountId`). Money goes **back from the seller’s Stripe balance** to the buyer. You don’t pay the refund.
- **If the order was paid on the platform** (legacy or non-Connect path): Refund is created on the platform Stripe account and you deduct from **SellerBalance**. Inventory is restored. (Current storefront UI uses Connect only, so new orders are Connect-refunded.)

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
| Mobile card payment     | **Seller** (Stripe Connect) |
| Website card payment    | **Seller** (Stripe Connect; same as app) |
| Shipping label purchase | **Seller** (their Shippo) |
| Connect refund          | **Seller** (from their Stripe) |
| Platform-order refund   | **Platform** (your Stripe + SellerBalance) |
| Cash orders             | No platform; seller and buyer in person |

---

## 9. Legacy platform checkout

- The route `storefront-checkout` (platform Checkout Session) is **no longer used** by the storefront UI. Cart, product, and resale pages all use `storefront-checkout-intent` (Connect) only. If you need platform-collected payments for another use case, that route still exists.
