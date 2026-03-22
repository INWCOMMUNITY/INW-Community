import type { Plan } from "database";

/** Subscribe, Business (internal plan id `sponsor`), or Seller — shared perks: coupon book, 2× points on purchases/scans. */
export const NWC_PAID_PLAN_SLUGS = ["subscribe", "sponsor", "seller"] as const;

export type NwcPaidPlanSlug = (typeof NWC_PAID_PLAN_SLUGS)[number];

/** Stripe-aligned subscription rows that still receive paid NWC perks (not canceled / unpaid). */
export const NWC_PAID_PLAN_ACCESS_STATUSES = ["active", "trialing", "past_due"] as const;

export function prismaWhereActivePaidNwcPlan(memberId: string) {
  return {
    memberId,
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
    plan: { in: [...NWC_PAID_PLAN_SLUGS] },
  };
}

/** Business (sponsor) or Seller — Business Hub, some storefront flows (matches Stripe webhook statuses). */
const SPONSOR_OR_SELLER_PLANS: Plan[] = ["sponsor", "seller"];

export function prismaWhereMemberSponsorOrSellerPlanAccess(memberId: string) {
  return {
    memberId,
    plan: { in: SPONSOR_OR_SELLER_PLANS },
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
  };
}

/** Seller plan only — Seller Hub, new listings, Connect as seller, refunds, etc. */
export function prismaWhereMemberSellerPlanAccess(memberId: string) {
  return {
    memberId,
    plan: "seller" as const,
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
  };
}

/** Business (sponsor) plan only — duplicate registration checks, etc. */
export function prismaWhereMemberSponsorPlanAccess(memberId: string) {
  return {
    memberId,
    plan: "sponsor" as const,
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
  };
}

/** Seller or Resident Subscribe — Connect onboarding (no Business-only). */
export function prismaWhereMemberSellerOrSubscribeAccess(memberId: string) {
  const st = { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] };
  return {
    memberId,
    OR: [{ plan: "seller" as const, status: st }, { plan: "subscribe" as const, status: st }],
  };
}
