import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

/**
 * Attach storefront listings with no `businessId` to a business (idempotent).
 * Used when Seller Hub should reuse an existing Business Hub profile.
 */
export async function linkAllUnscopedStoreItemsToBusiness(
  memberId: string,
  businessId: string
): Promise<number> {
  const r = await prisma.storeItem.updateMany({
    where: {
      memberId,
      businessId: null,
    },
    data: { businessId },
  });
  return r.count;
}

/**
 * After Business → Seller (or Subscribe → Seller), point items missing `businessId` at the
 * member's oldest business so Seller Hub matches their existing Business Hub setup.
 */
export async function migrateResaleItemsForSellerMember(memberId: string): Promise<void> {
  const sellerRow = await prisma.subscription.findFirst({
    where: prismaWhereMemberSellerPlanAccess(memberId),
  });
  if (!sellerRow) return;

  const business = await prisma.business.findFirst({
    where: { memberId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!business) return;

  await linkAllUnscopedStoreItemsToBusiness(memberId, business.id);
}
