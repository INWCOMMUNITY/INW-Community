import { prisma, SHOPIFY_MAX_OPTION_DIMENSIONS, SHOPIFY_MAX_VARIANTS } from "database";
import { listingDisplayPhotos } from "@/lib/listing-display-photo";
import { shopifyBlocksSharedQuantityPool } from "@/lib/listing-variant-matrix";

export type ShopifyEligibleListing = {
  storeItemId: string;
  title: string;
  photos: string[];
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  updatedAt: string;
  variantCount: number;
  /** Custom options that Shopify shows only after metafields are on the product page. */
  needsShopifyMetafields: boolean;
  /** One quantity shared by every combination. Shopify cannot list this. */
  usesSharedQuantityPool: boolean;
};

/**
 * Active INW listings (1..100 variants, ≤3 axes) for the seller that are not
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
      photos: true,
      slug: true,
      sku: true,
      priceCents: true,
      quantity: true,
      status: true,
      updatedAt: true,
      variants: true,
      storeVariants: {
        where: { status: "ACTIVE" },
        select: { id: true, options: true },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const eligible = items
    .filter((item) => {
      const count = item.storeVariants.length;
      if (count < 1 || count > SHOPIFY_MAX_VARIANTS) return false;
      if (count === 1) return true;
      // Multi-variant: validate axis count from options
      const axisNames = new Set<string>();
      for (const v of item.storeVariants) {
        const opts = typeof v.options === "string" ? JSON.parse(v.options) : v.options;
        if (opts && typeof opts === "object") {
          for (const key of Object.keys(opts as Record<string, unknown>)) {
            axisNames.add(key);
          }
        }
      }
      return axisNames.size >= 1 && axisNames.size <= SHOPIFY_MAX_OPTION_DIMENSIONS;
    })
    .map((item) => ({
      storeItemId: item.id,
      title: item.title,
      photos: listingDisplayPhotos(item.photos, "thumb", 4),
      slug: item.slug,
      sku: item.sku,
      priceCents: item.priceCents,
      quantity: item.quantity,
      status: item.status,
      updatedAt: item.updatedAt.toISOString(),
      variantCount: item.storeVariants.length,
      needsShopifyMetafields: false,
      usesSharedQuantityPool: shopifyBlocksSharedQuantityPool(item.variants),
    }));

  if (eligible.length === 0) return eligible;
  const withFields = await prisma.listingBuyerField.findMany({
    where: { storeItemId: { in: eligible.map((item) => item.storeItemId) } },
    select: { storeItemId: true },
    distinct: ["storeItemId"],
  });
  const metafieldIds = new Set(withFields.map((row) => row.storeItemId));
  return eligible.map((item) => ({
    ...item,
    needsShopifyMetafields: metafieldIds.has(item.storeItemId),
  }));
}
