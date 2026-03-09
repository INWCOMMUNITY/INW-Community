import { prisma } from "database";

/**
 * Disconnects a member from Stripe Connect: clears stripeConnectAccountId and
 * disables all their currently listed (active) store items so they no longer
 * appear for sale. Sold items are left as-is. Allows re-onboarding afterward.
 */
export async function disconnectStripeAndDisableListings(memberId: string): Promise<void> {
  await prisma.$transaction([
    prisma.member.update({
      where: { id: memberId },
      data: { stripeConnectAccountId: null },
    }),
    prisma.storeItem.updateMany({
      where: { memberId, status: "active" },
      data: { status: "inactive" },
    }),
  ]);
}
