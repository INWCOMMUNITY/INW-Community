import { buildProductHref, type ProductReferrerType } from "@/lib/product-referrer";

/** Live storefront URL from Sync Airport (falls back to edit when slug is missing). */
export function appsAirportInwLiveListingHref(input: {
  slug?: string | null;
  storeItemId: string;
  from: Extract<ProductReferrerType, "etsy-sync" | "shopify-sync">;
}): string {
  const slug = input.slug?.trim();
  if (slug) return buildProductHref(slug, { type: input.from });
  return `/seller-hub/store/${input.storeItemId}`;
}
