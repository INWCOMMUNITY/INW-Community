import { prisma } from "database";

export type ShopifyEligibleListing = {
  storeItemId: string;
  title: string;
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  updatedAt: string;
  variantCount: number;
  /** When false, List on Shopify should show an explicit block reason. */
  supported: boolean;
  unsupportedReason: string | null;
};

const MAX_SHOPIFY_VARIANTS = 100;

/**
 * Active INW listings for the seller that are not already mapped on the current
 * ACTIVE Shopify connection generation. Multi-variant listings are eligible when
 * they have 1–100 ACTIVE variants.
 */
export async function listEligibleShopifyExportListings(input: {
  memberId: string;
  connectionId: string;
}): Promise<ShopifyEligibleListing[]> {
  const mapped = await prisma.shopifyListingLink.findMany({
    where: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
    },
    select: { storeItemId: true },
  });
  const mappedIds = mapped.map((row) => row.storeItemId);

  const items = await prisma.storeItem.findMany({
    where: {
      memberId: input.memberId,
      status: "active",
      ...(mappedIds.length > 0 ? { id: { notIn: mappedIds } } : {}),
    },
    select: {
      id: true,
      title: true,
      slug: true,
      sku: true,
      priceCents: true,
      quantity: true,
      status: true,
      updatedAt: true,
      storeVariants: {
        where: { status: "ACTIVE" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return items.map((item) => {
    const variantCount = item.storeVariants.length;
    let supported = true;
    let unsupportedReason: string | null = null;
    if (variantCount === 0) {
      supported = false;
      unsupportedReason = "Listing has no active variants";
    } else if (variantCount > MAX_SHOPIFY_VARIANTS) {
      supported = false;
      unsupportedReason = `Shopify export supports at most ${MAX_SHOPIFY_VARIANTS} variants`;
    }
    return {
      storeItemId: item.id,
      title: item.title,
      slug: item.slug,
      sku: item.sku,
      priceCents: item.priceCents,
      quantity: item.quantity,
      status: item.status,
      updatedAt: item.updatedAt.toISOString(),
      variantCount,
      supported,
      unsupportedReason,
    };
  });
}
