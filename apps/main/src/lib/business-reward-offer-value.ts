import { prisma } from "database";

/** $1,000 total face value from offered rewards (Σ cash value × redemption limit). */
export const COMMUNITY_STAR_REWARD_OFFER_THRESHOLD_CENTS = 100_000;

/** Matches Community Star badge copy: count rewards first created in this rolling window. */
const ROLLING_MONTHS = 6;

export function communityStarRewardOfferWindowStart(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - ROLLING_MONTHS);
  return d;
}

/**
 * Σ (cashValueCents × redemptionLimit) for rewards created in the rolling window,
 * status active or redeemed_out, non-null/zero cash value. Inactive (removed) listings excluded.
 */
export async function getBusinessRewardOfferValueCentsRolling(businessId: string): Promise<number> {
  const since = communityStarRewardOfferWindowStart();
  const rows = await prisma.reward.findMany({
    where: {
      businessId,
      status: { in: ["active", "redeemed_out"] },
      createdAt: { gte: since },
      cashValueCents: { gt: 0 },
    },
    select: { cashValueCents: true, redemptionLimit: true },
  });
  let total = 0;
  for (const r of rows) {
    const cents = r.cashValueCents ?? 0;
    if (cents <= 0) continue;
    total += cents * r.redemptionLimit;
  }
  return total;
}
