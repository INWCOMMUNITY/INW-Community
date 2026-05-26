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

## Subscription end and perk cleanup

When a member has **no** remaining active/trialing/past_due NWC subscription, `removeNwcMemberPerksAfterSubscriptionEnd` (`apps/main/src/lib/nwc-subscription-perk-cleanup.ts`) runs (Stripe webhook / sync):

- Deletes businesses, coupons, and rewards tied to **non–**`adminGrantedAt` businesses.
- Deactivates store listings linked only to non-granted businesses.
- **Keeps** rows where `Business.adminGrantedAt` is set.

## Admin-granted access (`adminGrantedAt`)

`Business.adminGrantedAt` (nullable timestamp) marks a directory business as **admin-assigned**: the owner gets Business Hub and public directory listing **without** an active sponsor/seller subscription.

Used when:

1. Admin creates or reassigns a business for a member with no paid Business/Seller sub (`POST`/`PATCH` `/api/admin/businesses`).
2. Admin **pauses** a paying member’s subscription but retains their profile (see below).

Access checks: `hasBusinessHubAccess` (`apps/main/src/lib/business-hub-access.ts`), public directory (`GET /api/businesses`, `public-business-directory.ts`), and `GET /api/me` → `hasBusinessHubAccess`.

**Not included:** Seller Hub (`canAccessSellerHub` still requires active **seller** plan). Public seller storefront (`GET /api/sellers/[slug]`) also requires seller plan.

## Admin pause: stop billing, keep business profile

**Not** Stripe “pause collection”—immediate cancel of sponsor/seller subs plus pre-grant so cleanup does not delete the profile.

| Step | What happens |
|------|----------------|
| 1 | `adminGrantedAt` set on **all** member businesses (must run **before** Stripe cancel). |
| 2 | Stripe `subscriptions.cancel` for active/trialing/past_due **sponsor** and **seller** subs. |
| 3 | `syncStripeSubscriptionsForMember` updates DB `Subscription.status`. |
| 4 | Webhook may call perk cleanup; granted businesses survive. |

**API:** `POST /api/admin/members/[id]/pause-subscription` (admin session or `x-admin-code`).

**Logic:** `apps/main/src/lib/pause-member-subscription-retain-profile.ts`

**Admin UI:** Subscriptions and Members in `apps/admin` and `apps/main/src/app/admin/dashboard` — **Pause & keep profile**; **Profile retained** badge when `adminGrantedAt` is set.

**Members list flag:** `GET /api/admin/members` includes `canPauseSubscriptionRetainProfile` (has business + active sponsor/seller sub).

**Mobile app:** No changes required; existing `/api/me` `hasBusinessHubAccess` already reflects `adminGrantedAt`.

**Out of scope:** Unpause admin action, resident-only (`subscribe`) pause without business, Seller Hub retention after seller cancel.

**Policy:** Consider a Terms clause that INW may grant continued directory/Business Hub access without an active subscription (`apps/main/src/lib/terms-content.ts`).

## Related code

- `apps/main/src/app/api/me/route.ts` — `isSubscriber`, `hasResaleHubAccess`, `subscriptionPlan`, `subscriptions`
- `apps/main/src/lib/subscribe-plan-access.ts` — Subscribe-only vs subscribe-tier queries
- `apps/main/src/lib/nwc-paid-subscription.ts` — paid plan statuses and sponsor/seller access helpers
- `apps/main/src/lib/nwc-subscription-perk-cleanup.ts` — strip perks when all paid subs end
- `apps/main/src/lib/business-hub-access.ts` — paid sponsor/seller or `adminGrantedAt`
- `apps/main/src/lib/pause-member-subscription-retain-profile.ts` — admin pause + retain profile
- `apps/main/src/app/api/admin/members/[id]/pause-subscription/route.ts` — admin pause endpoint
