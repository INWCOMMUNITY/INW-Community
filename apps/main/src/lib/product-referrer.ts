/**
 * Tracks where the user came from when viewing a product, enabling adaptive back navigation.
 * Share URLs, sitemaps, and Open Graph stay canonical (no `from=`).
 */

export type ProductReferrerType =
  | "storefront"
  | "seller"
  | "feed"
  | "feed-collection"
  | "collection"
  | "wishlist"
  | "cart"
  | "messages"
  | "my-items"
  | "offer"
  | "order";

export type ProductReferrer = {
  type: ProductReferrerType;
  sellerSlug?: string;
  sellerName?: string;
  collectionId?: string;
  offerId?: string;
  orderId?: string;
  orderKind?: "seller" | "buyer";
  threadId?: string;
  threadKind?: "resale" | "chat";
};

const PRESERVE_KEYS = [
  "from",
  "seller",
  "sellerName",
  "collectionId",
  "offerId",
  "orderId",
  "orderKind",
  "threadId",
  "threadKind",
  "listingType",
] as const;

type ParamSource = { get(name: string): string | null } | null | undefined;

function paramGet(params: ParamSource, key: string): string | null {
  if (!params) return null;
  const v = params.get(key);
  return v && v.length > 0 ? v : null;
}

export function getProductReferrer(searchParams: ParamSource): ProductReferrer {
  const from = paramGet(searchParams, "from");
  if (from === "seller") {
    return {
      type: "seller",
      sellerSlug: paramGet(searchParams, "seller") ?? undefined,
      sellerName: paramGet(searchParams, "sellerName") ?? undefined,
    };
  }
  if (from === "feed") return { type: "feed" };
  if (from === "feed-collection") {
    const collectionId = paramGet(searchParams, "collectionId") ?? undefined;
    return collectionId ? { type: "feed-collection", collectionId } : { type: "feed" };
  }
  if (from === "collection") {
    const collectionId = paramGet(searchParams, "collectionId") ?? undefined;
    return collectionId ? { type: "collection", collectionId } : { type: "storefront" };
  }
  if (from === "wishlist") return { type: "wishlist" };
  if (from === "cart") return { type: "cart" };
  if (from === "messages") {
    return {
      type: "messages",
      threadId: paramGet(searchParams, "threadId") ?? undefined,
      threadKind: paramGet(searchParams, "threadKind") === "resale" ? "resale" : "chat",
    };
  }
  if (from === "my-items") return { type: "my-items" };
  if (from === "offer") {
    return { type: "offer", offerId: paramGet(searchParams, "offerId") ?? undefined };
  }
  if (from === "order") {
    const orderKind = paramGet(searchParams, "orderKind");
    return {
      type: "order",
      orderId: paramGet(searchParams, "orderId") ?? undefined,
      orderKind: orderKind === "buyer" ? "buyer" : "seller",
    };
  }
  return { type: "storefront" };
}

export function referrerToSearchParams(ref: ProductReferrer): URLSearchParams {
  const params = new URLSearchParams();
  if (ref.type === "storefront") return params;
  params.set("from", ref.type);
  if (ref.sellerSlug) params.set("seller", ref.sellerSlug);
  if (ref.sellerName) params.set("sellerName", ref.sellerName);
  if (ref.collectionId) params.set("collectionId", ref.collectionId);
  if (ref.offerId) params.set("offerId", ref.offerId);
  if (ref.orderId) params.set("orderId", ref.orderId);
  if (ref.orderKind) params.set("orderKind", ref.orderKind);
  if (ref.threadId) params.set("threadId", ref.threadId);
  if (ref.threadKind) params.set("threadKind", ref.threadKind);
  return params;
}

export function buildProductHref(slug: string, ref: ProductReferrer, extra?: Record<string, string>): string {
  const params = referrerToSearchParams(ref);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  const q = params.toString();
  return q ? `/storefront/${slug}?${q}` : `/storefront/${slug}`;
}

/** Copy `from` (and listingType) when hopping listing → listing. */
export function listingHrefPreservingReferrer(slug: string, searchParams: ParamSource): string {
  const params = new URLSearchParams();
  if (searchParams) {
    for (const key of PRESERVE_KEYS) {
      const v = paramGet(searchParams, key);
      if (v) params.set(key, v);
    }
  }
  const q = params.toString();
  return q ? `/storefront/${slug}?${q}` : `/storefront/${slug}`;
}

export function buildBackLink(ref: ProductReferrer): { href: string; label: string } {
  switch (ref.type) {
    case "seller":
      if (ref.sellerSlug) {
        return {
          href: `/support-local/sellers/${ref.sellerSlug}`,
          label: `Back to ${ref.sellerName || "Seller"}`,
        };
      }
      break;
    case "feed":
      return { href: "/my-community/feed", label: "Back to Feed" };
    case "feed-collection":
      if (ref.collectionId) {
        return { href: `/feed/collections/${ref.collectionId}`, label: "Back to Collection" };
      }
      return { href: "/my-community/feed", label: "Back to Feed" };
    case "collection":
      if (ref.collectionId) {
        return { href: `/feed/collections/${ref.collectionId}`, label: "Back to Collection" };
      }
      break;
    case "wishlist":
      return { href: "/my-community/wantlist", label: "Back to Wishlist" };
    case "cart":
      return { href: "/cart", label: "Back to Cart" };
    case "messages":
      return { href: "/my-community/messages", label: "Back to Messages" };
    case "my-items":
      return { href: "/seller-hub/store/items", label: "Back to My Items" };
    case "offer":
      return { href: "/seller-hub/offers", label: "Back to Offers" };
    case "order":
      if (ref.orderKind === "buyer") {
        if (ref.orderId) {
          return { href: `/my-community/orders/${ref.orderId}`, label: "Back to Order" };
        }
        return { href: "/my-community/orders", label: "Back to My Orders" };
      }
      if (ref.orderId) {
        return { href: `/seller-hub/orders/${ref.orderId}`, label: "Back to Order" };
      }
      return { href: "/seller-hub/orders", label: "Back to Orders" };
    default:
      break;
  }
  return { href: "/storefront", label: "Back to Storefront" };
}

/** Seller shop → listing (existing callers). */
export function buildProductLinkWithReferrer(
  productSlug: string,
  sellerSlug: string,
  sellerName: string
): string {
  return buildProductHref(productSlug, {
    type: "seller",
    sellerSlug,
    sellerName,
  });
}
