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
};

/**
 * Active, simple (exactly one variant) INW listings for the seller that are not
 * already mapped on the current ACTIVE Shopify connection generation.
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
        select: { id: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return items
    .filter((item) => item.storeVariants.length === 1)
    .map((item) => ({
      storeItemId: item.id,
      title: item.title,
      slug: item.slug,
      sku: item.sku,
      priceCents: item.priceCents,
      quantity: item.quantity,
      status: item.status,
      updatedAt: item.updatedAt.toISOString(),
    }));
}
