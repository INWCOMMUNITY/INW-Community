# NWC subscription perks and plan switches

## Switching plans

When a member switches NWC paid plans in Stripe, their subscription row is updated to the new `plan`. Entitlements follow **that** plan only. There is no “doubling up” of unrelated perks from two paid products unless the member actually has two active subscription records (unusual).

## Effective plan label (`subscriptionPlan`)

`resolveEffectiveNwcPlan` in `apps/main/src/lib/resolve-effective-nwc-plan.ts` is the single source of truth for which plan the member is treated as for mobile JWT and `GET /api/me`. If multiple active paid rows ever exist, priority is **Seller → Business (`sponsor`) → Resident Subscribe**.

## Tier perks vs Resale Hub

- **Subscribe tier perks** (coupon book, 2× points on eligible purchases/scans, `isSubscriber` on `/api/me`): granted when the member has an active **subscribe**, **sponsor**, or **seller** subscription. Business and Seller **include** these resident-tier benefits as part of that plan; that is bundled entitlement, not stacking two separate subscriptions.
- **Resale Hub** (the member NWC resale hub experience): **Resident Subscribe only** — `hasResaleHubAccess` uses `prismaWhereMemberSubscribePlanAccess` in `apps/main/src/lib/subscribe-plan-access.ts` (see also `GET /api/me`). Business and Seller use Business Hub and Seller Hub for storefront flows; Seller does not get Resale Hub without an active Subscribe plan.

## Related code

- `apps/main/src/app/api/me/route.ts` — `isSubscriber`, `hasResaleHubAccess`, `subscriptionPlan`, `subscriptions`
- `apps/main/src/lib/subscribe-plan-access.ts` — Subscribe-only vs subscribe-tier queries
- `apps/main/src/lib/nwc-paid-subscription.ts` — paid plan statuses and sponsor/seller access helpers
