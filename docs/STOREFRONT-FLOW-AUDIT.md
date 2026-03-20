# Storefront Flow Audit

An in-depth audit of the full storefront flow from **list item** through **delivery**, including cart, multi-vendor checkout, address verification, cancel/refund, shipping labels and tracking, quantity enforcement, sold items, pickups, delivery, resale offers, and messaging. This document states current behavior, key file references for web and app, and lists bugs and gaps with recommended fixes.

---

## Scope

End-to-end flow: **list item** → **storefront visibility** → **cart** → **multi-vendor checkout** → **address verification** → **cancel / request refund** → **shipping labels & tracking** → **quantity enforcement** → **sold items** → **pickups** → **delivery** → **resale offers** → **messaging**.

---

## 1. List item → storefront

### Current behavior

- **Create:** `POST /api/store-items`. Web: [apps/main/src/app/seller-hub/store/new/page.tsx](apps/main/src/app/seller-hub/store/new/page.tsx); app: [apps/mobile/app/seller-hub/store/new.tsx](apps/mobile/app/seller-hub/store/new.tsx). API: [apps/main/src/app/api/store-items/route.ts](apps/main/src/app/api/store-items/route.ts).
- **Blockers (403/400):** Stripe Connect required (403); Shippo required if shipping offered (403); at least one of shipping / local delivery / pickup; policies when offering pickup/shipping; quantity ≥ 1; content validation. On success, item is `status: "active"` and gets a slug.
- **Storefront:** `GET /api/store-items` (no `mine`/`slug`) returns public list with `quantity > 0`, `status: "active"`, seller has Connect, and items in pending orders excluded (reserved). API uses `force-dynamic`; no long-lived cache.

### Key files

| Role | Path |
|------|------|
| API (create + list) | [apps/main/src/app/api/store-items/route.ts](apps/main/src/app/api/store-items/route.ts) |
| Web storefront list | [apps/main/src/app/storefront/page.tsx](apps/main/src/app/storefront/page.tsx), [apps/main/src/components/StorefrontGallery.tsx](apps/main/src/components/StorefrontGallery.tsx) |
| Web PDP | [apps/main/src/app/storefront/[slug]/page.tsx](apps/main/src/app/storefront/[slug]/page.tsx) |
| App store list | [apps/mobile/app/(tabs)/store.tsx](apps/mobile/app/(tabs)/store.tsx) |
| App PDP | [apps/mobile/app/product/[slug].tsx](apps/mobile/app/product/[slug].tsx) |

### Audit notes

- On success (no Stripe/listing errors), the item should appear on storefront immediately on both web and app; no extra cache invalidation is required.
- Document 403/400 messages (e.g. “Complete Stripe Connect in Seller Hub → Payouts”, “Set up Shippo before offering shipping”) so they match intended UX.

---

## 2. Cart and multi-vendor checkout

### Current behavior

- **Cart:** Per user; lines include `storeItem`, fulfillment, and `unavailableReason`. APIs: [apps/main/src/app/api/cart/route.ts](apps/main/src/app/api/cart/route.ts) (GET/POST/DELETE), [apps/main/src/app/api/cart/[itemId]/route.ts](apps/main/src/app/api/cart/[itemId]/route.ts) (PATCH/DELETE).
- **One checkout, multiple sellers:** [apps/main/src/app/api/stripe/storefront-checkout-intent/route.ts](apps/main/src/app/api/stripe/storefront-checkout-intent/route.ts) creates **one PaymentIntent per seller** on each seller’s **Stripe Connect** account. Money goes to individual Connect accounts.
- **Redirect Checkout:** [apps/main/src/app/api/stripe/storefront-checkout/route.ts](apps/main/src/app/api/stripe/storefront-checkout/route.ts) — one session for all line items; webhook credits SellerBalance (platform 5%). Native intent path uses Connect only (no SellerBalance).
- **Cash:** [apps/main/src/app/api/store-orders/cash-checkout/route.ts](apps/main/src/app/api/store-orders/cash-checkout/route.ts) when all items are pickup or local delivery; each seller must accept cash.

### Key files

| Role | Path |
|------|------|
| Web cart + checkout | [apps/main/src/app/cart/page.tsx](apps/main/src/app/cart/page.tsx), [apps/main/src/app/storefront/checkout/page.tsx](apps/main/src/app/storefront/checkout/page.tsx) |
| App cart + checkout | [apps/mobile/app/cart.tsx](apps/mobile/app/cart.tsx), [apps/mobile/components/StorefrontNativeCheckoutButton.tsx](apps/mobile/components/StorefrontNativeCheckoutButton.tsx) |
| Webhook (balance, inventory) | [apps/main/src/app/api/stripe/webhook/route.ts](apps/main/src/app/api/stripe/webhook/route.ts) |

### Audit notes

- Web and app both support cart with items from multiple sellers and one checkout flow (intent + Payment Sheet on app, redirect or Elements on web).
- Cart grouping by seller and one `StoreOrder` per seller is consistent; buyer “My Orders” reflects this on web and app.

---

## 3. Address verification and “auto edit” to Shippo format

### Current behavior

- **API:** [apps/main/src/app/api/validate-address/route.ts](apps/main/src/app/api/validate-address/route.ts) calls Shippo v2 validate; returns `formatted` (valid) or `suggestedFormatted` (invalid but suggested). No server-side overwrite of user input.
- **Web cart:** [apps/main/src/app/cart/page.tsx](apps/main/src/app/cart/page.tsx) — before card checkout, validates with `requireCarrierVerification: true`; on success uses `formatted` as `resolvedShippingAddress` and **sends that** in the checkout payload. The **visible form is not updated** with the formatted address (no `setShippingAddress(formatted)` after validation).
- **App:** [apps/mobile/components/StorefrontNativeCheckoutButton.tsx](apps/mobile/components/StorefrontNativeCheckoutButton.tsx) — validates, retries with `suggestedFormatted` if needed, then sends `validateData.formatted` (plus aptOrSuite) in the checkout payload. Same: payload is Shippo-format; UI may not show the corrected address.
- **Persistence:** [apps/main/src/app/api/stripe/storefront-checkout-intent/route.ts](apps/main/src/app/api/stripe/storefront-checkout-intent/route.ts) (e.g. line ~250) stores `shippingAddress` on the order so sellers/label flow see the same format.

### Gaps and recommendation

- **Done:** The address **sent** to the backend (and stored on the order) is already the Shippo-formatted one (web and app).
- **Gap:** The **visible** address fields are not auto-updated with the formatted/suggested address. **Recommendation:** After successful validation, call `setShippingAddress(formatted)` (web cart) / equivalent (app checkout) so the user sees the corrected address before submitting.

---

## 4. Cancel vs request refund

### Current behavior

- **Cancel (before ship):** [apps/main/src/app/api/store-orders/[id]/cancel/route.ts](apps/main/src/app/api/store-orders/[id]/cancel/route.ts). Allowed only when `order.status === "paid"`.
  - **Card:** Stripe refund, seller balance deduction, **inventory restored**.
  - **Cash:** Order set to `canceled`, points deducted; **inventory is NOT restored** (bug: lines 72–80).
- **Request refund:** [apps/main/src/app/api/store-orders/[id]/request-refund/route.ts](apps/main/src/app/api/store-orders/[id]/request-refund/route.ts). Card only; sets `refundRequestedAt` / `refundReason`; seller runs actual refund via [apps/main/src/app/api/store-orders/[id]/refund/route.ts](apps/main/src/app/api/store-orders/[id]/refund/route.ts).
- **UI:** Web [apps/main/src/app/my-community/orders/page.tsx](apps/main/src/app/my-community/orders/page.tsx): Cancel when `status === "paid"`; Request refund when (paid or shipped) and card and not already requested. App [apps/mobile/app/community/my-orders/[id].tsx](apps/mobile/app/community/my-orders/[id].tsx): shows both when paid and not refund-requested; backend enforces cancel only when paid.

### Bug

- **Cash cancel:** In [apps/main/src/app/api/store-orders/[id]/cancel/route.ts](apps/main/src/app/api/store-orders/[id]/cancel/route.ts), for cash orders (lines 72–80) only status and points are updated; **inventory is never restored**. When a buyer cancels a cash (pickup/delivery) order before fulfillment, item quantity stays decremented.
- **Recommendation:** For the cash cancel path, restore quantity the same way as card cancel (increment `StoreItem` quantity / option quantities per order item using `incrementOptionQuantity` / `quantity: { increment }` from [apps/main/src/lib/store-item-variants.ts](apps/main/src/lib/store-item-variants.ts)).

### Audit notes

- Ensure wording: “Cancel” = full cancel (and refund for card); “Request refund” = ask seller to refund (available after ship). Web and app copy should match; “automatic if item has not shipped” should clearly refer to “Cancel” (immediate), not “Request refund.”

---

## 5. Tracking and shipping labels

### Current behavior

- **Labels:** Shippo Shipping Elements on **website** only: [apps/main/src/components/StorefrontOrdersContent.tsx](apps/main/src/components/StorefrontOrdersContent.tsx), [apps/main/src/app/seller-hub/orders/page.tsx](apps/main/src/app/seller-hub/orders/page.tsx), [apps/main/src/app/seller-hub/orders/[id]/page.tsx](apps/main/src/app/seller-hub/orders/[id]/page.tsx), [apps/main/src/app/resale-hub/(with-sidebar)/orders/page.tsx](apps/main/src/app/resale-hub/(with-sidebar)/orders/page.tsx). After label purchase, client calls [apps/main/src/app/api/shipping/label-from-elements/route.ts](apps/main/src/app/api/shipping/label-from-elements/route.ts); backend creates/updates `Shipment`, sets order to shipped, sends tracking email/push.
- **App:** No embedded Shippo widget. Seller uses “Purchase labels” / “Purchase another label” to **open the website** (e.g. storefront or resale-hub orders) to buy/print labels. See [apps/mobile/app/seller-hub/orders/[id].tsx](apps/mobile/app/seller-hub/orders/[id].tsx) (`openWebLabels`).
- **Tracking (buyer):** Stored in `Shipment` (`trackingNumber`, `carrier`). Buyer order payload includes `shipment`. **Web** [apps/main/src/app/my-community/orders/page.tsx](apps/main/src/app/my-community/orders/page.tsx): `getTrackingUrl(carrier, trackingNumber)` — USPS, UPS, FedEx, else Google. **App** [apps/mobile/app/community/my-orders/[id].tsx](apps/mobile/app/community/my-orders/[id].tsx): tracking link is always `https://www.google.com/search?q=track+{trackingNumber}` (e.g. lines 197–199).

### Gaps and recommendations

- **Labels “from the app”:** Currently implemented as “open web in browser.” If the requirement is “printing labels from the app,” document that this is “via opening website” unless an in-app WebView or Shippo SDK is added.
- **Tracking parity:** App should use **carrier-specific** tracking URLs when `carrier` is known (same logic as web `getTrackingUrl`). **Recommendation:** Add a `getTrackingUrl(carrier, trackingNumber)` helper in the app (e.g. in [apps/mobile/lib/](apps/mobile/lib/) or in the order detail screen) and use it on the buyer order detail screen instead of always using Google search.

---

## 6. Shippo setup

### Current behavior

- **Web:** [apps/main/src/app/seller-hub/shipping-setup/page.tsx](apps/main/src/app/seller-hub/shipping-setup/page.tsx) — Shippo OAuth only (`GET /api/shipping/oauth-start`). Callback: [apps/main/src/app/api/shipping/oauth-callback/route.ts](apps/main/src/app/api/shipping/oauth-callback/route.ts). Legacy page: [apps/main/src/app/shippo-oauth-redirect/page.tsx](apps/main/src/app/shippo-oauth-redirect/page.tsx).
- **App:** [apps/mobile/app/seller-hub/shipping-setup/index.tsx](apps/mobile/app/seller-hub/shipping-setup/index.tsx) — `POST /api/shipping/oauth-link` + `WebBrowser.openAuthSessionAsync`, then deep link back to the app (`inwcommunity://seller-hub/shipping-setup`).

### Key files

| Role | Path |
|------|------|
| OAuth / status | [apps/main/src/app/api/shipping/oauth-start/route.ts](apps/main/src/app/api/shipping/oauth-start/route.ts), [apps/main/src/app/api/shipping/oauth-link/route.ts](apps/main/src/app/api/shipping/oauth-link/route.ts), [apps/main/src/app/api/shipping/oauth-callback/route.ts](apps/main/src/app/api/shipping/oauth-callback/route.ts), [apps/main/src/app/api/shipping/status/route.ts](apps/main/src/app/api/shipping/status/route.ts) |
| Deprecated | [apps/main/src/app/api/shipping/connect/route.ts](apps/main/src/app/api/shipping/connect/route.ts) returns 410 (API key paste removed) |

### Audit notes

- Shippo requires billing and Address Book for production labels; OAuth flow covers sign-in and permissions.

---

## 7. Quantity counts (prevent oversell)

### Current behavior

- **Listing:** [apps/main/src/app/api/store-items/route.ts](apps/main/src/app/api/store-items/route.ts) POST/PATCH require quantity ≥ 1 (and variant option sums).
- **Cart:** [apps/main/src/app/api/cart/route.ts](apps/main/src/app/api/cart/route.ts) uses `getAvailableQuantity`; [apps/main/src/app/api/cart/[itemId]/route.ts](apps/main/src/app/api/cart/[itemId]/route.ts) caps quantity at available.
- **Checkout:** [apps/main/src/app/api/stripe/storefront-checkout-intent/route.ts](apps/main/src/app/api/stripe/storefront-checkout-intent/route.ts) and [apps/main/src/app/api/store-orders/cash-checkout/route.ts](apps/main/src/app/api/store-orders/cash-checkout/route.ts) re-check `getAvailableQuantity` and reject if requested > available; single-qty items in another buyer’s pending order are blocked.
- **Storefront list:** `GET /api/store-items` excludes items in pending orders (reserved).
- **Decrement:** Webhook (`checkout.session.completed` / `payment_intent.succeeded`) and [apps/main/src/app/api/store-orders/cash-checkout/route.ts](apps/main/src/app/api/store-orders/cash-checkout/route.ts) decrement quantity (and set `sold_out` when 0). Helpers: [apps/main/src/lib/store-item-variants.ts](apps/main/src/lib/store-item-variants.ts) (`getAvailableQuantity`, `decrementOptionQuantity`, `incrementOptionQuantity`).
- **Restore:** [apps/main/src/app/api/store-orders/[id]/refund/route.ts](apps/main/src/app/api/store-orders/[id]/refund/route.ts) and [apps/main/src/app/api/store-orders/[id]/cancel/route.ts](apps/main/src/app/api/store-orders/[id]/cancel/route.ts) (card path only) restore quantity. **Cancel (cash):** does not restore (see Section 4).

### Audit notes

- Variant/option quantities are respected in cart, checkout, webhook, refund, and card cancel. Fix cash-cancel restore so quantity is never “stuck” decremented.
- Regression checklist: add to cart at max, checkout; confirm quantity 0 and sold_out; cancel/refund and confirm quantity restored.

---

## 8. Sold items page and “sold” disclosure

### Current behavior

- **Seller (web):** [apps/main/src/app/seller-hub/store/items/page.tsx](apps/main/src/app/seller-hub/store/items/page.tsx) — tabs Active / Ended / **Sold**; “Sold” text and “Sold on [date]”, “View order” link. No red “SOLD” badge.
- **Seller (app):** [apps/mobile/app/seller-hub/store/sold.tsx](apps/mobile/app/seller-hub/store/sold.tsx) — list of sold items, “Sold on [date]” or “Sold”, “View order.” No red “SOLD” badge.
- **Buyer:** “My Orders” (web and app) shows orders and order detail (items, tracking). Buyer does not have a “sold items” page; they see purchases as orders. “View order” from seller sold item goes to the same order detail as from My Orders.

### Gap and recommendation

- **Requirement:** “Sold items page … with the disclosure that the item is sold in red.” Current disclosure is text only.
- **Recommendation:** Add a clear **red** “SOLD” label/badge on (1) website My Items Sold tab rows ([apps/main/src/app/seller-hub/store/items/page.tsx](apps/main/src/app/seller-hub/store/items/page.tsx)), (2) app Sold Items list cards ([apps/mobile/app/seller-hub/store/sold.tsx](apps/mobile/app/seller-hub/store/sold.tsx)), and optionally (3) buyer order detail when showing a purchased item (e.g. red “Purchased” or “Sold to you”).

---

## 9. Pickups and delivery

### Current behavior

- **Pickup:** Buyer chooses pickup → [apps/main/src/components/PickupTermsModal.tsx](apps/main/src/components/PickupTermsModal.tsx) (web) / [apps/mobile/components/PickupTermsModal.tsx](apps/mobile/components/PickupTermsModal.tsx) (app) → cart/checkout with `fulfillmentType: "pickup"` and `pickupDetails`. Seller: [apps/main/src/app/seller-hub/pickups/page.tsx](apps/main/src/app/seller-hub/pickups/page.tsx), [apps/main/src/app/resale-hub/(with-sidebar)/pickups/page.tsx](apps/main/src/app/resale-hub/(with-sidebar)/pickups/page.tsx), [apps/mobile/app/seller-hub/pickups/index.tsx](apps/mobile/app/seller-hub/pickups/index.tsx) — list orders with pickup items, “Mark as picked up” → `PATCH /api/store-orders/[id]` with `deliveryConfirmed: true`.
- **Delivery:** [apps/main/src/components/LocalDeliveryModal.tsx](apps/main/src/components/LocalDeliveryModal.tsx) (web) / [apps/mobile/components/LocalDeliveryModal.tsx](apps/mobile/components/LocalDeliveryModal.tsx) (app) → `localDeliveryDetails` in cart and checkout. Seller: Deliveries pages (seller-hub, resale-hub, app) → “Mark as delivered” (same PATCH). Order update: [apps/main/src/app/api/store-orders/[id]/route.ts](apps/main/src/app/api/store-orders/[id]/route.ts) PATCH `deliveryConfirmed: true` sets `deliveryConfirmedAt`.

### Audit notes

- Pickup details (name, phone, preferred time, terms) and delivery details (address, etc.) are validated at checkout and stored on order; seller sees them on Pickups/Deliveries. Web and app support pickup and delivery forms; seller flows (list, filter, mark confirmed) work the same on web and app.

---

## 10. Resale offers and messaging from listing

### Current behavior

- **Offers:** API [apps/main/src/app/api/resale-offers/route.ts](apps/main/src/app/api/resale-offers/route.ts) POST (create), [apps/main/src/app/api/resale-offers/[id]/route.ts](apps/main/src/app/api/resale-offers/[id]/route.ts) PATCH (accept/decline/counter). Web [apps/main/src/app/resale/[slug]/page.tsx](apps/main/src/app/resale/[slug]/page.tsx) has “Make offer” modal. **App product detail** [apps/mobile/app/product/[slug].tsx](apps/mobile/app/product/[slug].tsx): has `listingType` and “Message Seller”; **no “Make offer” UI** for resale items.
- **Messaging:** [apps/main/src/app/api/resale-messages/route.ts](apps/main/src/app/api/resale-messages/route.ts) POST (storeItemId + content) creates/finds ResaleConversation. Web resale/[slug] and app product/[slug] both have “Message seller” and navigate to conversation. Replies: [apps/main/src/app/api/resale-conversations/[id]/route.ts](apps/main/src/app/api/resale-conversations/[id]/route.ts). App: [apps/mobile/app/messages/resale/[id].tsx](apps/mobile/app/messages/resale/[id].tsx).

### Gap and recommendation

- **Gap:** Buyers on **mobile** cannot make offers from the product screen. **Recommendation:** Add “Make offer” (and optionally accept/decline counter) on [apps/mobile/app/product/[slug].tsx](apps/mobile/app/product/[slug].tsx) when `listingType === "resale"` and item has `acceptOffers` (or equivalent from API). Reuse same APIs as web (POST resale-offers, PATCH resale-offers/[id]).
- Messaging from resale listing: web and app both support; navigation from “Message seller” to the resale conversation works on app.

---

## 11. Summary: bugs and gaps

| Area | Issue | Severity | Action |
|------|--------|----------|--------|
| Cash cancel | Inventory not restored when buyer cancels cash order | Bug | Restore quantity in [apps/main/src/app/api/store-orders/[id]/cancel/route.ts](apps/main/src/app/api/store-orders/[id]/cancel/route.ts) for cash path (same as card): increment `StoreItem` quantity / option quantities per order item. |
| Address “auto edit” | Form fields not updated with Shippo formatted address before submit | UX | After validation success, set shipping address state to formatted in [apps/main/src/app/cart/page.tsx](apps/main/src/app/cart/page.tsx) (web) and [apps/mobile/components/StorefrontNativeCheckoutButton.tsx](apps/mobile/components/StorefrontNativeCheckoutButton.tsx) (app) so user sees correction. |
| Tracking (app) | App always uses Google search for tracking link | Parity | Add `getTrackingUrl(carrier, trackingNumber)` helper in app and use it in [apps/mobile/app/community/my-orders/[id].tsx](apps/mobile/app/community/my-orders/[id].tsx) (USPS, UPS, FedEx, else Google). |
| Sold disclosure | No red “SOLD” label on seller sold items (web/app) | UX | Add red SOLD badge in [apps/main/src/app/seller-hub/store/items/page.tsx](apps/main/src/app/seller-hub/store/items/page.tsx) (Sold tab) and [apps/mobile/app/seller-hub/store/sold.tsx](apps/mobile/app/seller-hub/store/sold.tsx); optionally on buyer order item. |
| Resale offers (app) | No “Make offer” on mobile product page for resale | Gap | Add Make offer flow to [apps/mobile/app/product/[slug].tsx](apps/mobile/app/product/[slug].tsx) when `listingType === "resale"` and `acceptOffers`; use POST/PATCH [apps/main/src/app/api/resale-offers](apps/main/src/app/api/resale-offers). |
| Labels from app | Labels are purchased by opening website, not in-app widget | Doc | Document that “printing labels from the app” is via opening website; optionally add in-app WebView to Shippo flow if required. |

---

## 12. Recommended implementation order

1. **Bug:** Cash cancel inventory restore (prevents stuck quantity).
2. **Parity:** App tracking URLs (carrier-specific).
3. **UX:** Address form auto-update with Shippo formatted address (web + app).
4. **UX:** Red SOLD badge (website Sold tab + app Sold Items).
5. **Gap:** Make offer on app product page for resale.
6. **Doc:** Clarify label printing from app (web vs in-app).

---

*Storefront flow audit completed. Use this document as the reference for implementation before rebuild or push to git.*
