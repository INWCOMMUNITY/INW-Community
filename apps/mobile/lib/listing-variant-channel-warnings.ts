import {
  etsyVariesByAllProperties,
  isMadeToOrderTracking,
  MAX_ETSY_AXES,
  MAX_ETSY_SKUS_ALL_PROPERTIES,
  MAX_SKU_ROWS_EBAY,
  MAX_SKU_ROWS_SHOPIFY,
  matrixHasLinkedOptionPhotos,
  normalizeVariantMatrix,
} from "@/lib/listing-variant-matrix";

/** Seller-facing notes when a matrix cannot map 1:1 onto a linked marketplace. */
export function listingVariantChannelWarnings(args: {
  variants: unknown;
  inventoryTracking?: string | null;
  linkedProviders: string[];
}): string[] {
  const providers = args.linkedProviders.map((p) => p.toLowerCase());
  if (providers.length === 0) return [];
  const out: string[] = [];
  const matrix = normalizeVariantMatrix(args.variants);
  const mto = isMadeToOrderTracking(args.inventoryTracking);

  if (providers.includes("etsy") && matrix && matrix.axes.length > MAX_ETSY_AXES) {
    out.push(
      `This item cannot be listed on Etsy — Etsy allows at most ${MAX_ETSY_AXES} option types. Remove an option type or unsync Etsy.`
    );
  }
  if (
    providers.includes("etsy") &&
    matrix &&
    etsyVariesByAllProperties(matrix) &&
    matrix.skus.length > MAX_ETSY_SKUS_ALL_PROPERTIES
  ) {
    out.push(
      `This item cannot be listed on Etsy — when price, quantity, or SKU varies across all three option types, Etsy allows at most ${MAX_ETSY_SKUS_ALL_PROPERTIES} combinations.`
    );
  }
  if (providers.includes("shopify") && matrix && matrix.skus.length > MAX_SKU_ROWS_SHOPIFY) {
    out.push(
      `This item cannot be listed on Shopify — Shopify (REST sync) supports at most ${MAX_SKU_ROWS_SHOPIFY} combinations. Reduce options or unsync Shopify.`
    );
  }
  if (providers.includes("ebay") && matrix && matrix.skus.length > MAX_SKU_ROWS_EBAY) {
    out.push(
      `This item cannot be listed on eBay — eBay supports at most ${MAX_SKU_ROWS_EBAY} variations. Reduce combinations or unsync eBay.`
    );
  }
  if (providers.includes("ebay") && matrix && matrix.axes.length > 1) {
    out.push(
      "eBay can only vary listing pictures by one option type (usually Color). Other combinations share those photos."
    );
  }
  if (providers.includes("wix") && matrix && matrixHasLinkedOptionPhotos(matrix)) {
    out.push("Wix will show the main gallery; color photos stay on INW and other shops.");
  }
  if (mto && providers.some((p) => p === "ebay" || p === "etsy")) {
    out.push(
      "Made-to-order listings send a placeholder quantity to eBay and Etsy (they do not support unlimited stock)."
    );
  }
  return out;
}
