import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";

/**
 * Resident Subscribe ($10/mo) — DB rows that unlock Resale Hub, session flags, and related APIs.
 * Status list matches `prismaWhereActivePaidNwcPlan` / Stripe webhook mapping.
 */
export function prismaWhereMemberSubscribePlanAccess(memberId: string) {
  return {
    memberId,
    plan: "subscribe" as const,
    status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
  };
}
