import { prisma } from "database";
import { NWC_PAID_PLAN_ACCESS_STATUSES } from "@/lib/nwc-paid-subscription";
import type { SubscriptionPlan } from "@/lib/mobile-auth";

/** Highest privilege first: Seller > Business (sponsor) > Resident (subscribe). */
const PRIORITY: SubscriptionPlan[] = ["seller", "sponsor", "subscribe"];

/**
 * Single source of truth for which NWC plan the member "is" for mobile JWT and /api/me.
 * Use instead of unordered DB rows or stale JWT claims.
 */
export async function resolveEffectiveNwcPlan(memberId: string): Promise<SubscriptionPlan | null> {
  for (const plan of PRIORITY) {
    if (plan === "subscribe") {
      const row = await prisma.subscription.findFirst({
        where: {
          memberId,
          plan: "subscribe" as const,
          status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
        },
        select: { plan: true },
      });
      if (row) return "subscribe";
    } else {
      const row = await prisma.subscription.findFirst({
        where: {
          memberId,
          plan,
          status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
        },
        select: { plan: true },
      });
      if (row) return plan;
    }
  }
  return null;
}
