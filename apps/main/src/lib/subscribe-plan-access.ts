import type { Plan } from "database";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";

const SUBSCRIBE_TIER_PLANS: Plan[] = ["subscribe", "sponsor", "seller"];

/**
 * Resident Subscribe ($10/mo) only — last tier in `resolveEffectiveNwcPlan` (Seller > Business > Subscribe).
 */
export function prismaWhereMemberSubscribePlanAccess(memberId: string) {
  return {
    memberId,
    plan: "subscribe" as const,
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
  };
}

/**
 * Subscribe + Business + Seller with paid access — coupon book, 2× points on purchases/scans, mobile `isSubscriber`, etc.
 * Business and Seller plans include those resident perks. Resale Hub (member NWC Resale) is **not** included here;
 * use `prismaWhereMemberSubscribePlanAccess` for the Resident Subscribe plan only.
 */
export function prismaWhereMemberSubscribeTierPerksAccess(memberId: string) {
  return {
    memberId,
    plan: { in: SUBSCRIBE_TIER_PLANS },
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
  };
}
