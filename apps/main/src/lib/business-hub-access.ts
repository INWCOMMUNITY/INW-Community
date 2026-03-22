import { prisma } from "database";

/**
 * Member has Business Hub access if they have an active Business (sponsor) or Seller subscription
 * OR they own at least one business with adminGrantedAt set (admin gave them free access).
 */
export async function hasBusinessHubAccess(memberId: string): Promise<boolean> {
  const [sub, grantedBusiness] = await Promise.all([
    prisma.subscription.findFirst({
      where: {
        memberId,
        plan: { in: ["sponsor", "seller"] },
        status: "active",
      },
      select: { id: true },
    }),
    prisma.business.findFirst({
      where: { memberId, adminGrantedAt: { not: null } },
      select: { id: true },
    }),
  ]);
  return !!sub || !!grantedBusiness;
}
