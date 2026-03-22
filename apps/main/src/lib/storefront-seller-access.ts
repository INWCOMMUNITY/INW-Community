import { prisma } from "database";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";

/**
 * Seller Hub shipping/profile/label APIs (Shippo, etc.). Subscribe and Seller list resale or storefront;
 * Business-plan members may fulfill business orders and need the same tooling. Personal resale listing is still
 * subscribe-or-seller only (enforced in store-items POST).
 */
export async function memberHasStorefrontListingAccess(memberId: string): Promise<boolean> {
  const sub = await prisma.subscription.findFirst({
    where: prismaWhereActivePaidNwcPlan(memberId),
  });
  return Boolean(sub);
}
