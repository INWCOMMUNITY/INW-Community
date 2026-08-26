/**
 * Tracks where the user came from when viewing a business, enabling adaptive back navigation.
 * Share URLs stay canonical (no `from=`).
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

type ExpoParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  if (value == null) return null;
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : null;
}

export function getBusinessReferrer(params: ExpoParams | null | undefined): BusinessReferrer {
  const from = first(params?.from);
  if (from === "my-businesses") return { type: "my-businesses" };
  if (from === "feed") return { type: "feed" };
  if (from === "member-profile") {
    const memberId = first(params?.memberId) ?? undefined;
    return memberId ? { type: "member-profile", memberId } : { type: "directory" };
  }
  if (from === "member-businesses") {
    const memberId = first(params?.memberId) ?? undefined;
    return memberId ? { type: "member-businesses", memberId } : { type: "directory" };
  }
  if (from === "listing") {
    const listingSlug = first(params?.listingSlug) ?? undefined;
    return listingSlug ? { type: "listing", listingSlug } : { type: "directory" };
  }
  if (from === "event") {
    const eventSlug = first(params?.eventSlug) ?? undefined;
    return eventSlug ? { type: "event", eventSlug } : { type: "directory" };
  }
  if (from === "wantlist") return { type: "wantlist" };
  if (from === "seller") {
    const sellerSlug = first(params?.seller) ?? undefined;
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

export function buildBusinessPath(slug: string, ref: BusinessReferrer): string {
  const q = referrerToSearchParams(ref).toString();
  return q ? `/business/${slug}?${q}` : `/business/${slug}`;
}

export function buildBusinessBackLink(ref: BusinessReferrer): { href: string; label: string } {
  switch (ref.type) {
    case "my-businesses":
      return { href: "/profile-businesses", label: "Back to My Businesses" };
    case "feed":
      return { href: "/(tabs)", label: "Back to Feed" };
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
        return { href: `/product/${ref.listingSlug}`, label: "Back to Listing" };
      }
      break;
    case "event":
      if (ref.eventSlug) {
        return { href: `/event/${ref.eventSlug}`, label: "Back to Event" };
      }
      break;
    case "wantlist":
      return { href: "/profile-wishlist", label: "Back to Wishlist" };
    case "seller":
      if (ref.sellerSlug) {
        return { href: `/seller/${ref.sellerSlug}`, label: "Back to Seller" };
      }
      break;
    default:
      break;
  }
  return { href: "/(tabs)/support-local", label: "Back to Support Local" };
}
