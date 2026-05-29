import type { Plan } from "database";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";

const SUBSCRIBE_TIER_PLANS: Plan[] = ["subscribe", "sponsor", "seller"];

/**
 * Subscribe + Business + Seller with paid access — coupon book, 2× points on purchases/scans, mobile `isSubscriber`, etc.
 * Business and Seller plans include those resident perks.
 */
export function prismaWhereMemberSubscribeTierPerksAccess(memberId: string) {
  return {
    memberId,
    plan: { in: SUBSCRIBE_TIER_PLANS },
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
  };
}
