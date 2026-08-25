import { prisma } from "database";

export const LISTING_SELLER_BUSINESS_SELECT = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  logoUrl: true,
} as const;

export type ListingSellerBusiness = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  logoUrl: string | null;
};

export type ListingFeedPostRef = {
  type: string;
  authorId: string;
  sourceBusinessId?: string | null;
  sourceStoreItemId?: string | null;
  sourceListingCollectionId?: string | null;
};

export function isSellerListingFeedPostType(type: string): boolean {
  return type === "shared_store_item" || type === "shared_listing_collection";
}

export async function sellerPrimaryBusinessForMember(
  memberId: string
): Promise<ListingSellerBusiness | null> {
  return prisma.business.findFirst({
    where: { memberId },
    orderBy: { createdAt: "asc" },
    select: LISTING_SELLER_BUSINESS_SELECT,
  });
}

export async function loadPrimaryBusinessByMemberIds(
  memberIds: string[]
): Promise<Record<string, ListingSellerBusiness>> {
  const unique = [...new Set(memberIds.filter(Boolean))];
  if (unique.length === 0) return {};
  const rows = await prisma.business.findMany({
    where: { memberId: { in: unique } },
    orderBy: { createdAt: "asc" },
    select: { ...LISTING_SELLER_BUSINESS_SELECT, memberId: true },
  });
  const map: Record<string, ListingSellerBusiness> = {};
  for (const row of rows) {
    if (map[row.memberId]) continue;
    map[row.memberId] = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      shortDescription: row.shortDescription,
      logoUrl: row.logoUrl,
    };
  }
  return map;
}

/** Authors of listing posts that should show as the seller business (owner shares only). */
export function listingAuthorIdsNeedingSellerBusiness(
  posts: ListingFeedPostRef[],
  storeItemOwnerById: Map<string, string>
): string[] {
  const ids: string[] = [];
  for (const p of posts) {
    if (p.sourceBusinessId) continue;
    if (p.type === "shared_listing_collection") {
      ids.push(p.authorId);
      continue;
    }
    if (p.type === "shared_store_item" && p.sourceStoreItemId) {
      const owner = storeItemOwnerById.get(p.sourceStoreItemId);
      if (owner && owner === p.authorId) ids.push(p.authorId);
    }
  }
  return ids;
}

export async function listingSellerBusinessMapForPosts(
  posts: ListingFeedPostRef[],
  storeItems: { id: string; memberId?: string }[]
): Promise<Record<string, ListingSellerBusiness>> {
  const ownerById = new Map<string, string>();
  for (const s of storeItems) {
    if (s.memberId) ownerById.set(s.id, s.memberId);
  }
  return loadPrimaryBusinessByMemberIds(
    listingAuthorIdsNeedingSellerBusiness(posts, ownerById)
  );
}

export function resolveFeedPostSourceBusiness(
  p: ListingFeedPostRef,
  businessById: Record<string, ListingSellerBusiness>,
  listingBizByMemberId: Record<string, ListingSellerBusiness>
): ListingSellerBusiness | null {
  if (p.sourceBusinessId) {
    return businessById[p.sourceBusinessId] ?? listingBizByMemberId[p.authorId] ?? null;
  }
  if (isSellerListingFeedPostType(p.type)) {
    return listingBizByMemberId[p.authorId] ?? null;
  }
  return null;
}
