/**
 * Tracks where the user came from when viewing a product, enabling adaptive back navigation.
 * Share URLs stay canonical (no `from=`).
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

type ExpoParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (value == null) return null;
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : null;
}

export function getProductReferrer(params: ExpoParams | null | undefined): ProductReferrer {
  const from = first(params?.from);
  if (from === "seller") {
    return {
      type: "seller",
      sellerSlug: first(params?.seller) ?? undefined,
      sellerName: first(params?.sellerName) ?? undefined,
    };
  }
  if (from === "feed") return { type: "feed" };
  if (from === "feed-collection") {
    const collectionId = first(params?.collectionId) ?? undefined;
    return collectionId ? { type: "feed-collection", collectionId } : { type: "feed" };
  }
  if (from === "collection") {
    const collectionId = first(params?.collectionId) ?? undefined;
    return collectionId ? { type: "collection", collectionId } : { type: "storefront" };
  }
  if (from === "wishlist") return { type: "wishlist" };
  if (from === "cart") return { type: "cart" };
  if (from === "messages") {
    return {
      type: "messages",
      threadId: first(params?.threadId) ?? undefined,
      threadKind: first(params?.threadKind) === "resale" ? "resale" : "chat",
    };
  }
  if (from === "my-items") return { type: "my-items" };
  if (from === "offer") {
    return { type: "offer", offerId: first(params?.offerId) ?? undefined };
  }
  if (from === "order") {
    const orderKind = first(params?.orderKind);
    return {
      type: "order",
      orderId: first(params?.orderId) ?? undefined,
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

export function buildProductPath(slug: string, ref: ProductReferrer, extra?: Record<string, string>): string {
  const params = referrerToSearchParams(ref);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  const q = params.toString();
  return q ? `/product/${slug}?${q}` : `/product/${slug}`;
}

export function listingPathPreservingReferrer(slug: string, params: ExpoParams | null | undefined): string {
  const search = new URLSearchParams();
  if (params) {
    for (const key of PRESERVE_KEYS) {
      const v = first(params[key]);
      if (v) search.set(key, v);
    }
  }
  const q = search.toString();
  return q ? `/product/${slug}?${q}` : `/product/${slug}`;
}

export function buildBackLink(ref: ProductReferrer): { href: string; label: string } {
  switch (ref.type) {
    case "seller":
      if (ref.sellerSlug) {
        return {
          href: `/seller/${ref.sellerSlug}`,
          label: `Back to ${ref.sellerName || "Seller"}`,
        };
      }
      break;
    case "feed":
      return { href: "/(tabs)", label: "Back to Feed" };
    case "feed-collection":
      if (ref.collectionId) {
        return { href: `/feed/collections/${ref.collectionId}`, label: "Back to Collection" };
      }
      return { href: "/(tabs)", label: "Back to Feed" };
    case "collection":
      if (ref.collectionId) {
        return { href: `/collections/${ref.collectionId}`, label: "Back to Collection" };
      }
      break;
    case "wishlist":
      return { href: "/profile-wishlist", label: "Back to Wishlist" };
    case "cart":
      return { href: "/cart", label: "Back to Cart" };
    case "messages":
      if (ref.threadId) {
        const path =
          ref.threadKind === "resale" ? `/messages/resale/${ref.threadId}` : `/messages/${ref.threadId}`;
        return { href: path, label: "Back to Messages" };
      }
      return { href: "/(tabs)/my-community", label: "Back to Messages" };
    case "my-items":
      return { href: "/seller-hub/store/items", label: "Back to My Items" };
    case "offer":
      if (ref.offerId) {
        return { href: `/offers/${ref.offerId}`, label: "Back to Offer" };
      }
      return { href: "/seller-hub/offers", label: "Back to Offers" };
    case "order":
      if (ref.orderId && ref.orderKind === "buyer") {
        return { href: `/community/my-orders/${ref.orderId}`, label: "Back to Order" };
      }
      if (ref.orderId) {
        return { href: `/seller-hub/orders/${ref.orderId}`, label: "Back to Order" };
      }
      return { href: "/seller-hub/orders", label: "Back to Orders" };
    default:
      break;
  }
  return { href: "/(tabs)/store", label: "Back to Store" };
}
