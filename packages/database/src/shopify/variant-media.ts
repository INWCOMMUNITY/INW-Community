import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Variant ↔ Media association using existing marketplace-neutral models:
 * - StoreVariant.photos (canonical URLs ordered)
 * - ShopifyMediaMap.storeVariantId (optional association to a StoreVariant)
 *
 * No Shopify-only pseudo-canonical field is invented.
 */

export type VariantMediaAssociationPlan = {
  storeVariantId: string;
  inwMediaIds: string[];
  shopifyMediaIds: string[];
};

export type ShopifyVariantMediaInboundDb = PrismaClient | Prisma.TransactionClient;

/**
 * Plan associations from StoreVariant.photos against durable product media maps.
 * Matches by sourceUrl → inwMediaId → shopifyMediaId when mapped.
 */
export function planVariantMediaAssociations(input: {
  variants: Array<{ storeVariantId: string; photos: string[] }>;
  mediaMaps: Array<{
    inwMediaId: string;
    sourceUrl: string | null;
    shopifyMediaId: string | null;
    status: string;
  }>;
}): VariantMediaAssociationPlan[] {
  const active = input.mediaMaps.filter((m) => m.status === "ACTIVE");
  const byUrl = new Map(
    active
      .filter((m) => m.sourceUrl?.trim())
      .map((m) => [m.sourceUrl!.trim(), m] as const)
  );

  return input.variants.map((variant) => {
    const inwMediaIds: string[] = [];
    const shopifyMediaIds: string[] = [];
    for (const photo of variant.photos) {
      const url = typeof photo === "string" ? photo.trim() : "";
      if (!url) continue;
      const map = byUrl.get(url);
      if (!map) continue;
      inwMediaIds.push(map.inwMediaId);
      if (map.shopifyMediaId) shopifyMediaIds.push(map.shopifyMediaId);
    }
    return {
      storeVariantId: variant.storeVariantId,
      inwMediaIds,
      shopifyMediaIds,
    };
  });
}

/**
 * Plan inbound associations from remote ProductVariant media GIDs.
 * Identity is ProductVariant GID + Media GID only — never SKU.
 */
export function planVariantMediaInboundAssociations(input: {
  mappedVariants: Array<{ storeVariantId: string; shopifyVariantId: string }>;
  remoteVariantMedia: Array<{ shopifyVariantId: string; shopifyMediaIds: string[] }>;
  mediaMaps: Array<{
    inwMediaId: string;
    sourceUrl: string | null;
    shopifyMediaId: string | null;
    status: string;
  }>;
}): Array<{
  storeVariantId: string;
  shopifyVariantId: string;
  photos: string[];
  inwMediaIds: string[];
  shopifyMediaIds: string[];
}> {
  const active = input.mediaMaps.filter((m) => m.status === "ACTIVE" && m.shopifyMediaId);
  const byMediaGid = new Map(active.map((m) => [m.shopifyMediaId!, m] as const));
  const remoteByVariant = new Map(
    input.remoteVariantMedia.map((row) => [row.shopifyVariantId, row.shopifyMediaIds] as const)
  );

  return input.mappedVariants.map((variant) => {
    const mediaIds = remoteByVariant.get(variant.shopifyVariantId) ?? [];
    const photos: string[] = [];
    const inwMediaIds: string[] = [];
    const shopifyMediaIds: string[] = [];
    for (const mediaId of mediaIds) {
      const map = byMediaGid.get(mediaId);
      if (!map) continue;
      shopifyMediaIds.push(mediaId);
      inwMediaIds.push(map.inwMediaId);
      if (map.sourceUrl?.trim()) photos.push(map.sourceUrl.trim());
    }
    return {
      storeVariantId: variant.storeVariantId,
      shopifyVariantId: variant.shopifyVariantId,
      photos,
      inwMediaIds,
      shopifyMediaIds,
    };
  });
}

/**
 * Apply Shopify→INW variant media associations after product media maps exist.
 * Updates StoreVariant.photos and ShopifyMediaMap.storeVariantId via exact GIDs.
 */
export async function applyShopifyVariantMediaInbound(
  db: ShopifyVariantMediaInboundDb,
  input: {
    listingLinkId: string;
    mappedVariants: Array<{ storeVariantId: string; shopifyVariantId: string }>;
    remoteVariantMedia: Array<{ shopifyVariantId: string; shopifyMediaIds: string[] }>;
  }
): Promise<{ action: string; updatedVariants: number }> {
  if (input.mappedVariants.length < 1) {
    return { action: "VARIANT_MEDIA_SKIPPED", updatedVariants: 0 };
  }

  const mediaMaps = await db.shopifyMediaMap.findMany({
    where: { shopifyListingLinkId: input.listingLinkId, status: "ACTIVE" },
    select: {
      id: true,
      inwMediaId: true,
      sourceUrl: true,
      shopifyMediaId: true,
      status: true,
      storeVariantId: true,
    },
  });

  const plans = planVariantMediaInboundAssociations({
    mappedVariants: input.mappedVariants,
    remoteVariantMedia: input.remoteVariantMedia,
    mediaMaps,
  });

  // Clear prior associations for mapped variants on this listing, then rebind.
  const mappedStoreVariantIds = input.mappedVariants.map((v) => v.storeVariantId);
  await db.shopifyMediaMap.updateMany({
    where: {
      shopifyListingLinkId: input.listingLinkId,
      storeVariantId: { in: mappedStoreVariantIds },
    },
    data: { storeVariantId: null },
  });

  let updatedVariants = 0;
  for (const plan of plans) {
    const current = await db.storeVariant.findUnique({
      where: { id: plan.storeVariantId },
      select: { photos: true },
    });
    if (!current) continue;

    const samePhotos =
      current.photos.length === plan.photos.length &&
      current.photos.every((url, i) => url === plan.photos[i]);

    if (!samePhotos) {
      await db.storeVariant.update({
        where: { id: plan.storeVariantId },
        data: { photos: plan.photos },
      });
      updatedVariants += 1;
    } else if (plan.inwMediaIds.length > 0) {
      updatedVariants += 1;
    }

    for (const inwMediaId of plan.inwMediaIds) {
      await db.shopifyMediaMap.updateMany({
        where: {
          shopifyListingLinkId: input.listingLinkId,
          inwMediaId,
        },
        data: { storeVariantId: plan.storeVariantId },
      });
    }
  }

  return {
    action: updatedVariants > 0 ? "VARIANT_MEDIA_APPLIED" : "VARIANT_MEDIA_UNCHANGED",
    updatedVariants,
  };
}
