import { prisma } from "database";
import { prismaWhereMemberSellerPlanAccess } from "@/lib/nwc-paid-subscription";

/** Attach resale listings with no business to a specific business (idempotent). */
export async function linkUnscopedResaleItemsToBusiness(
  memberId: string,
  businessId: string
): Promise<number> {
  const r = await prisma.storeItem.updateMany({
    where: {
      memberId,
      listingType: "resale",
      businessId: null,
    },
    data: { businessId },
  });
  return r.count;
}

/**
 * After Subscribe → Seller (or any Seller activation), point orphaned resale items at the
 * member's oldest business so Seller Hub treats them like the rest of the storefront.
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

  await linkUnscopedResaleItemsToBusiness(memberId, business.id);
}
