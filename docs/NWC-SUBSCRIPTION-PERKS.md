# NWC subscription perks and plan switches

## Switching plans

When a member switches NWC paid plans in Stripe, their subscription row is updated to the new `plan`. Entitlements follow **that** plan only. There is no “doubling up” of unrelated perks from two paid products unless the member actually has two active subscription records (unusual).

## Effective plan label (`subscriptionPlan`)

`resolveEffectiveNwcPlan` in `apps/main/src/lib/resolve-effective-nwc-plan.ts` is the single source of truth for which plan the member is treated as for mobile JWT and `GET /api/me`. If multiple active paid rows ever exist, priority is **Seller → Business (`sponsor`) → Resident Subscribe**.

## Tier perks vs Resale Hub

- **Subscribe tier perks** (coupon book, 2× points on eligible purchases/scans, `isSubscriber` on `/api/me`): granted when the member has an active **subscribe**, **sponsor**, or **seller** subscription. Business and Seller **include** these resident-tier benefits as part of that plan; that is bundled entitlement, not stacking two separate subscriptions.
- **Resale Hub** (the member NWC resale hub experience): **Resident Subscribe only** — `hasResaleHubAccess` uses `prismaWhereMemberSubscribePlanAccess` in `apps/main/src/lib/subscribe-plan-access.ts` (see also `GET /api/me`). Business and Seller use Business Hub and Seller Hub for storefront flows; Seller does not get Resale Hub without an active Subscribe plan.

## Business → Seller (same member)

Business and Seller share the same `Business` rows (`memberId`). When upgrading to Seller:

- Stripe checkout reuses the **oldest** existing business id in session metadata instead of creating a duplicate draft (`apps/main/src/app/api/stripe/checkout/route.ts`, `createBusinessDraftInDb`).
- Webhook metadata business creation skips creating a second business when `planId === "seller"` and a business already exists (`createBusinessFromMetadata` in `apps/main/src/app/api/stripe/webhook/route.ts`).
- On Seller activation, storefront items with no `businessId` are linked to that primary business (`migrateResaleItemsForSellerMember` / `linkAllUnscopedStoreItemsToBusiness` in `apps/main/src/lib/migrate-resale-items-for-seller-plan.ts`).

Member-level seller setup (Stripe Connect, Shippo, shipping/pickup policies on `Member`) is unchanged by plan switch; only subscription rows and entitlements update.

## Related code

- `apps/main/src/app/api/me/route.ts` — `isSubscriber`, `hasResaleHubAccess`, `subscriptionPlan`, `subscriptions`
- `apps/main/src/lib/subscribe-plan-access.ts` — Subscribe-only vs subscribe-tier queries
- `apps/main/src/lib/nwc-paid-subscription.ts` — paid plan statuses and sponsor/seller access helpers
