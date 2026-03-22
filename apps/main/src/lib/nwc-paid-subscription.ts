/** Subscribe, Business (internal plan id `sponsor`), or Seller — shared perks: coupon book, 2× points on purchases/scans. */
export const NWC_PAID_PLAN_SLUGS = ["subscribe", "sponsor", "seller"] as const;

export type NwcPaidPlanSlug = (typeof NWC_PAID_PLAN_SLUGS)[number];

export function prismaWhereActivePaidNwcPlan(memberId: string) {
  return {
    memberId,
    status: "active" as const,
    plan: { in: [...NWC_PAID_PLAN_SLUGS] },
  };
}
