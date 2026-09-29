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
