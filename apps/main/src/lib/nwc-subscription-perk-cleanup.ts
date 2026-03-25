import { prisma } from "database";
import {
  NWC_PAID_PLAN_ACCESS_STATUSES,
  NWC_PAID_PLAN_SLUGS,
} from "@/lib/nwc-paid-subscription";

/** True if the member still has any paid NWC plan row in good standing (Stripe-aligned). */
export async function memberHasAnyActiveNwcPlan(memberId: string): Promise<boolean> {
  const row = await prisma.subscription.findFirst({
    where: {
      memberId,
      plan: { in: [...NWC_PAID_PLAN_SLUGS] },
      status: { in: [...NWC_PAID_PLAN_ACCESS_STATUSES] },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * When the member has no remaining active/trialing/past_due NWC subscription, strip storefront
 * and directory perks tied to **subscription** access: listings go inactive (except those linked only
 * to admin-granted businesses), coupons/rewards removed for non–admin-granted businesses only,
 * and only those businesses are deleted. Rows with `adminGrantedAt` stay (free directory / perks per admin).
 * Idempotent: safe if already cleaned or if member still has an active plan (no-op).
 */
export async function removeNwcMemberPerksAfterSubscriptionEnd(memberId: string): Promise<void> {
  if (await memberHasAnyActiveNwcPlan(memberId)) return;

  await prisma.$transaction(async (tx) => {
    await tx.storeItem.updateMany({
      where: {
        memberId,
        status: "active",
        OR: [{ businessId: null }, { business: { adminGrantedAt: null } }],
      },
      data: { status: "inactive" },
    });
    await tx.coupon.deleteMany({
      where: { business: { memberId, adminGrantedAt: null } },
    });
    await tx.reward.deleteMany({
      where: { business: { memberId, adminGrantedAt: null } },
    });
    await tx.business.deleteMany({
      where: { memberId, adminGrantedAt: null },
    });

    await tx.storeItem.updateMany({
      where: { memberId, status: "active", businessId: null },
      data: { status: "inactive" },
    });
  });
}
