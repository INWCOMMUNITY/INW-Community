/**
 * Tracks where the user came from when viewing a business, enabling adaptive back navigation.
 * Share URLs, sitemaps, and Open Graph stay canonical (no `from=`).
 */

export type BusinessReferrerType =
  | "directory"
  | "my-businesses"
  | "feed"
  | "member-profile"
  | "member-businesses"
  | "listing"
  | "event"
  | "wantlist"
  | "seller";

export type BusinessReferrer = {
  type: BusinessReferrerType;
  memberId?: string;
  listingSlug?: string;
  eventSlug?: string;
  sellerSlug?: string;
};

type ParamSource = { get(name: string): string | null } | null | undefined;

function paramGet(params: ParamSource, key: string): string | null {
  if (!params) return null;
  const v = params.get(key);
  return v && v.length > 0 ? v : null;
}

export function getBusinessReferrer(searchParams: ParamSource): BusinessReferrer {
  const from = paramGet(searchParams, "from");
  if (from === "my-businesses") return { type: "my-businesses" };
  if (from === "feed") return { type: "feed" };
  if (from === "member-profile") {
    const memberId = paramGet(searchParams, "memberId") ?? undefined;
    return memberId ? { type: "member-profile", memberId } : { type: "directory" };
  }
  if (from === "member-businesses") {
    const memberId = paramGet(searchParams, "memberId") ?? undefined;
    return memberId ? { type: "member-businesses", memberId } : { type: "directory" };
  }
  if (from === "listing") {
    const listingSlug = paramGet(searchParams, "listingSlug") ?? undefined;
    return listingSlug ? { type: "listing", listingSlug } : { type: "directory" };
  }
  if (from === "event") {
    const eventSlug = paramGet(searchParams, "eventSlug") ?? undefined;
    return eventSlug ? { type: "event", eventSlug } : { type: "directory" };
  }
  if (from === "wantlist") return { type: "wantlist" };
  if (from === "seller") {
    const sellerSlug = paramGet(searchParams, "seller") ?? undefined;
    return sellerSlug ? { type: "seller", sellerSlug } : { type: "directory" };
  }
  return { type: "directory" };
}

export function referrerToSearchParams(ref: BusinessReferrer): URLSearchParams {
  const params = new URLSearchParams();
  if (ref.type === "directory") return params;
  params.set("from", ref.type);
  if (ref.memberId) params.set("memberId", ref.memberId);
  if (ref.listingSlug) params.set("listingSlug", ref.listingSlug);
  if (ref.eventSlug) params.set("eventSlug", ref.eventSlug);
  if (ref.sellerSlug) params.set("seller", ref.sellerSlug);
  return params;
}

export function buildBusinessHref(slug: string, ref: BusinessReferrer): string {
  const q = referrerToSearchParams(ref).toString();
  return q ? `/support-local/${slug}?${q}` : `/support-local/${slug}`;
}

export function buildBusinessBackLink(ref: BusinessReferrer): { href: string; label: string } {
  switch (ref.type) {
    case "my-businesses":
      return { href: "/my-community/businesses", label: "Back to My Businesses" };
    case "feed":
      return { href: "/my-community/feed", label: "Back to Feed" };
    case "member-profile":
      if (ref.memberId) {
        return { href: `/members/${ref.memberId}`, label: "Back to Profile" };
      }
      break;
    case "member-businesses":
      if (ref.memberId) {
        return { href: `/members/businesses/${ref.memberId}`, label: "Back to Favorite Businesses" };
      }
      break;
    case "listing":
      if (ref.listingSlug) {
        return { href: `/storefront/${ref.listingSlug}`, label: "Back to Listing" };
      }
      break;
    case "event":
      if (ref.eventSlug) {
        return { href: `/events/${ref.eventSlug}`, label: "Back to Event" };
      }
      break;
    case "wantlist":
      return { href: "/my-community/wantlist", label: "Back to Wishlist" };
    case "seller":
      if (ref.sellerSlug) {
        return { href: `/support-local/sellers/${ref.sellerSlug}`, label: "Back to Seller" };
      }
      break;
    default:
      break;
  }
  return { href: "/support-local", label: "Back to Support Local" };
}
