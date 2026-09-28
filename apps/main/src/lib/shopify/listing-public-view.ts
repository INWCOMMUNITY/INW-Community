import { prisma, toPublicShopifyListingStatus, type ShopifyListingPublicStatus } from "database";

export type ShopifyListingSellerView = ShopifyListingPublicStatus & {
  title: string;
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  storeItemStatus: string;
  shopifyVariantId: string | null;
  storeVariantId: string | null;
  inventoryDesiredAvailable: number | null;
  inventoryAppliedAvailable: number | null;
  inventoryInitState: string | null;
  inventoryDriftState: string | null;
  importSource: "NATIVE" | "SHOPIFY_IMPORT" | string;
  importedAt: string | null;
  updatedAt: string;
};

/**
 * Seller-facing listing rows for the ACTIVE connection: health + INW summary + primary variant map.
 * Read-only join; does not change sync semantics.
 */
export async function listShopifySellerListingViews(input: {
  memberId: string;
  connectionId: string;
}): Promise<ShopifyListingSellerView[]> {
  const listings = await prisma.shopifyListingLink.findMany({
    where: {
      shopifyConnectionId: input.connectionId,
      memberId: input.memberId,
    },
    include: {
      storeItem: {
        select: {
          title: true,
          slug: true,
          sku: true,
          priceCents: true,
          quantity: true,
          status: true,
        },
      },
      variantMaps: {
        select: {
          shopifyVariantId: true,
          storeVariantId: true,
          inventoryDesiredAvailable: true,
          inventoryAppliedAvailable: true,
          inventoryInitState: true,
          inventoryDriftState: true,
        },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return listings.map((row) => {
    const publicStatus = toPublicShopifyListingStatus(row);
    const variant = row.variantMaps[0] ?? null;
    return {
      ...publicStatus,
      title: row.storeItem.title,
      slug: row.storeItem.slug,
      sku: row.storeItem.sku,
      priceCents: row.storeItem.priceCents,
      quantity: row.storeItem.quantity,
      storeItemStatus: row.storeItem.status,
      shopifyVariantId: variant?.shopifyVariantId ?? null,
      storeVariantId: variant?.storeVariantId ?? null,
      inventoryDesiredAvailable: variant?.inventoryDesiredAvailable ?? null,
      inventoryAppliedAvailable: variant?.inventoryAppliedAvailable ?? null,
      inventoryInitState: variant?.inventoryInitState ?? null,
      inventoryDriftState: variant?.inventoryDriftState ?? null,
      importSource: row.importSource,
      importedAt: row.importedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}
