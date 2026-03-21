import { prisma } from "database";

const REWARD_PLACEHOLDER_TITLE = "__NWC_REWARD_FULFILLMENT__";

/**
 * Internal StoreItem used only for reward redemptions that need shipping (Stripe line item + Shippo flow).
 * Flat shipping rate is copied from the seller's most recently updated listing that has shippingCostCents set.
 */
export async function ensureRewardFulfillmentStoreItem(sellerMemberId: string): Promise<{
  id: string;
  shippingCostCents: number;
}> {
  const rateSample = await prisma.storeItem.findFirst({
    where: {
      memberId: sellerMemberId,
      shippingCostCents: { not: null },
      NOT: { title: REWARD_PLACEHOLDER_TITLE },
      status: { in: ["active", "sold_out"] },
    },
    select: { shippingCostCents: true },
    orderBy: { updatedAt: "desc" },
  });
  const shippingCostCents = rateSample?.shippingCostCents ?? 899;

  const existing = await prisma.storeItem.findFirst({
    where: { memberId: sellerMemberId, title: REWARD_PLACEHOLDER_TITLE },
    select: { id: true, shippingCostCents: true },
  });
  if (existing) {
    if (existing.shippingCostCents !== shippingCostCents) {
      await prisma.storeItem.update({
        where: { id: existing.id },
        data: { shippingCostCents },
      });
    }
    return { id: existing.id, shippingCostCents };
  }

  const slug = `reward-fulfill-${sellerMemberId.slice(0, 8)}-${Date.now()}`;
  const created = await prisma.storeItem.create({
    data: {
      memberId: sellerMemberId,
      title: REWARD_PLACEHOLDER_TITLE,
      description: "Internal placeholder for reward redemptions with shipping.",
      slug,
      priceCents: 0,
      quantity: 999_999,
      status: "inactive",
      photos: [],
      listingType: "new",
      shippingDisabled: false,
      shippingCostCents,
    },
  });
  return { id: created.id, shippingCostCents };
}
