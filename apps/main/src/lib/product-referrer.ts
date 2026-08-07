/**
 * Tracks where the user came from when viewing a product, enabling adaptive back navigation.
 */

export type ProductReferrer = {
  type: "storefront" | "seller";
  sellerSlug?: string;
  sellerName?: string;
};

/**
 * Parse referrer info from URL search params.
 * Expected params: ?from=seller&seller=slug&sellerName=Name
 */
export function getProductReferrer(searchParams: URLSearchParams | null): ProductReferrer {
  if (!searchParams) return { type: "storefront" };
  
  const from = searchParams.get("from");
  if (from === "seller") {
    return {
      type: "seller",
      sellerSlug: searchParams.get("seller") ?? undefined,
      sellerName: searchParams.get("sellerName") ?? undefined,
    };
  }
  return { type: "storefront" };
}

/**
 * Build the back link href and label based on referrer.
 */
export function buildBackLink(ref: ProductReferrer): { href: string; label: string } {
  if (ref.type === "seller" && ref.sellerSlug) {
    return {
      href: `/support-local/sellers/${ref.sellerSlug}`,
      label: `Back to ${ref.sellerName || "Seller"}`,
    };
  }
  return { href: "/storefront", label: "Back to Storefront" };
}

/**
 * Build a product link URL with referrer tracking.
 */
export function buildProductLinkWithReferrer(
  productSlug: string,
  sellerSlug: string,
  sellerName: string
): string {
  const params = new URLSearchParams({
    from: "seller",
    seller: sellerSlug,
    sellerName: sellerName,
  });
  return `/storefront/${productSlug}?${params.toString()}`;
}
