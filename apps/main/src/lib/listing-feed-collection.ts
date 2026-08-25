import { cache } from "react";
import { prisma } from "database";
import { LISTING_FEED_COLLECTION_MIN } from "@/lib/listing-feed-collection-constants";

export { LISTING_FEED_COLLECTION_MIN } from "@/lib/listing-feed-collection-constants";

export type ListingCollectionFeedEmbed = {
  id: string;
  title: string;
  itemCount: number;
  previewPhotos: string[];
};

export function formatListingCollectionDate(d = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export async function sellerListingDisplayName(memberId: string): Promise<string> {
  const biz = await prisma.business.findFirst({
    where: { memberId },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  const businessName = biz?.name?.trim();
  if (businessName) return businessName;
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { firstName: true, lastName: true },
  });
  const person = [member?.firstName, member?.lastName].filter(Boolean).join(" ").trim();
  return person || "Shop";
}

export async function buildListingCollectionTitle(memberId: string, at = new Date()): Promise<string> {
  const name = await sellerListingDisplayName(memberId);
  return `${name} New Listings ${formatListingCollectionDate(at)}`;
}

export type ListingFeedCollectionItem = {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  status: string;
  quantity: number;
};

export type ListingFeedCollectionDetail = {
  id: string;
  title: string;
  createdAt: string;
  items: ListingFeedCollectionItem[];
};

/** Card thumbs don't need the s-l2000 originals stored for listing pages. */
function collectionCardPhotoUrl(url: string): string {
  if (!url.includes("i.ebayimg.com")) return url;
  return url.replace(/s-l\d+/i, "s-l225");
}

export const getListingFeedCollectionById = cache(
  async function getListingFeedCollectionById(
    id: string
  ): Promise<ListingFeedCollectionDetail | null> {
    if (!id) return null;
    const collection = await prisma.listingFeedCollection.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        createdAt: true,
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            storeItem: {
              select: {
                id: true,
                title: true,
                slug: true,
                photos: true,
                priceCents: true,
                status: true,
                quantity: true,
              },
            },
          },
        },
      },
    });
    if (!collection) return null;

    return {
      id: collection.id,
      title: collection.title,
      createdAt: collection.createdAt.toISOString(),
      items: collection.items
        .map((row) => row.storeItem)
        .filter((item): item is NonNullable<typeof item> => item != null)
        .map((item) => {
          const photo = item.photos.find(Boolean);
          return {
            id: item.id,
            title: item.title,
            slug: item.slug,
            photos: photo ? [collectionCardPhotoUrl(photo)] : [],
            priceCents: item.priceCents,
            status: item.status,
            quantity: item.quantity,
          };
        }),
    };
  }
);

export function listingCollectionIdsFromPosts(
  posts: { sourceListingCollectionId?: string | null }[]
): string[] {
  const ids = new Set<string>();
  for (const p of posts) {
    if (p.sourceListingCollectionId) ids.add(p.sourceListingCollectionId);
  }
  return [...ids];
}

function previewPhotosFromItems(
  items: { storeItem: { photos: string[] } }[]
): string[] {
  const photos: string[] = [];
  for (const row of items) {
    const url = row.storeItem.photos.find(Boolean);
    if (url) photos.push(url);
    if (photos.length >= 3) break;
  }
  return photos;
}

export async function listingCollectionEmbedMap(
  collectionIds: string[]
): Promise<Record<string, ListingCollectionFeedEmbed>> {
  if (collectionIds.length === 0) return {};
  const unique = [...new Set(collectionIds)];
  const collections = await prisma.listingFeedCollection.findMany({
    where: { id: { in: unique } },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        select: { storeItem: { select: { photos: true } } },
      },
    },
  });
  const map: Record<string, ListingCollectionFeedEmbed> = {};
  for (const c of collections) {
    map[c.id] = {
      id: c.id,
      title: c.title,
      itemCount: c.items.length,
      previewPhotos: previewPhotosFromItems(c.items),
    };
  }
  return map;
}

export type ShareStoreItemsToFeedResult =
  | { ok: true; kind: "collection"; collectionId: string; postId: string; title: string }
  | { ok: true; kind: "items"; postIds: string[] }
  | { ok: false; error: string; status: number };

export async function shareStoreItemsToFeed(
  memberId: string,
  storeItemIds: string[]
): Promise<ShareStoreItemsToFeedResult> {
  const unique = [...new Set(storeItemIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: false, error: "Select at least one listing to share.", status: 400 };
  }
  if (unique.length > 200) {
    return { ok: false, error: "Too many listings to share at once.", status: 400 };
  }

  const items = await prisma.storeItem.findMany({
    where: { id: { in: unique }, memberId },
    select: { id: true },
  });
  if (items.length !== unique.length) {
    return { ok: false, error: "One or more listings were not found.", status: 404 };
  }
  const ordered = unique.filter((id) => items.some((it) => it.id === id));

  if (ordered.length >= LISTING_FEED_COLLECTION_MIN) {
    const title = await buildListingCollectionTitle(memberId);
    const collection = await prisma.listingFeedCollection.create({
      data: {
        memberId,
        title,
        items: {
          create: ordered.map((storeItemId, sortOrder) => ({ storeItemId, sortOrder })),
        },
      },
    });
    const post = await prisma.post.create({
      data: {
        type: "shared_listing_collection",
        authorId: memberId,
        sourceListingCollectionId: collection.id,
      },
    });
    return { ok: true, kind: "collection", collectionId: collection.id, postId: post.id, title };
  }

  const posts = await prisma.$transaction(
    ordered.map((storeItemId) =>
      prisma.post.create({
        data: {
          type: "shared_store_item",
          authorId: memberId,
          sourceStoreItemId: storeItemId,
        },
      })
    )
  );
  return { ok: true, kind: "items", postIds: posts.map((p) => p.id) };
}
