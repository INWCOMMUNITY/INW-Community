import { cache } from "react";
import { prisma } from "database";
import { LISTING_FEED_COLLECTION_MIN, isListingFeedCollectionPublicItem } from "@/lib/listing-feed-collection-constants";
import { listingDisplayPhoto } from "@/lib/listing-display-photo";
import { sellerPrimaryBusinessForMember } from "@/lib/listing-feed-seller-business";

export { LISTING_FEED_COLLECTION_MIN, isListingFeedCollectionPublicItem } from "@/lib/listing-feed-collection-constants";

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
  const biz = await sellerPrimaryBusinessForMember(memberId);
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

const listingFeedCollectionVisibleItemWhere = {
  storeItem: { status: { not: "inactive" } },
} as const;

export type ListingFeedCollectionDetail = {
  id: string;
  title: string;
  createdAt: string;
  items: ListingFeedCollectionItem[];
};

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
          where: listingFeedCollectionVisibleItemWhere,
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
        .filter((item) => isListingFeedCollectionPublicItem(item.status))
        .map((item) => {
          const photo = item.photos.find(Boolean);
          return {
            id: item.id,
            title: item.title,
            slug: item.slug,
            photos: photo ? [listingDisplayPhoto(photo, "thumb") ?? photo] : [],
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
    if (url) {
      photos.push(listingDisplayPhoto(url, "thumb") ?? url);
    }
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
    select: {
      id: true,
      title: true,
      _count: { select: { items: { where: listingFeedCollectionVisibleItemWhere } } },
      items: {
        where: listingFeedCollectionVisibleItemWhere,
        orderBy: { sortOrder: "asc" },
        take: 3,
        select: { storeItem: { select: { photos: true } } },
      },
    },
  });
  const map: Record<string, ListingCollectionFeedEmbed> = {};
  for (const c of collections) {
    map[c.id] = {
      id: c.id,
      title: c.title,
      itemCount: c._count.items,
      previewPhotos: previewPhotosFromItems(c.items),
    };
  }
  return map;
}

export type ShareStoreItemsToFeedResult =
  | { ok: true; kind: "collection"; collectionId: string; postId: string; title: string }
  | { ok: true; kind: "items"; postIds: string[] }
  | { ok: false; error: string; status: number };

export type ShareStoreItemsToFeedPostFields = {
  content?: string | null;
  photos?: string[];
  videos?: string[];
  links?: { url?: string; title?: string }[] | null;
  tags?: string[];
  taggedMemberIds?: string[];
  groupId?: string | null;
};

async function attachTagsToPosts(postIds: string[], tags: string[]): Promise<void> {
  if (postIds.length === 0 || tags.length === 0) return;
  const slugify = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const tagEntries = tags
    .map((t) => ({ name: t.trim(), slug: slugify(t) }))
    .filter((e) => e.slug.length > 0);
  if (tagEntries.length === 0) return;
  const tagSlugs = tagEntries.map((e) => e.slug);
  const existingTags = await prisma.tag.findMany({ where: { slug: { in: tagSlugs } } });
  const existingSlugs = new Set(existingTags.map((t) => t.slug));
  const newEntries = tagEntries.filter((e) => !existingSlugs.has(e.slug));
  if (newEntries.length > 0) {
    await prisma.tag.createMany({
      data: newEntries.map((e) => ({ name: e.name, slug: e.slug })),
      skipDuplicates: true,
    });
  }
  const allTags = await prisma.tag.findMany({ where: { slug: { in: tagSlugs } } });
  if (allTags.length === 0) return;
  await prisma.postTag.createMany({
    data: postIds.flatMap((postId) => allTags.map((tag) => ({ postId, tagId: tag.id }))),
    skipDuplicates: true,
  });
}

export async function shareStoreItemsToFeed(
  memberId: string,
  storeItemIds: string[],
  postFields: ShareStoreItemsToFeedPostFields = {}
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
  const sourceBusinessId = (await sellerPrimaryBusinessForMember(memberId))?.id ?? null;

  let groupId: string | null = null;
  if (postFields.groupId) {
    const membership = await prisma.groupMember.findUnique({
      where: {
        groupId_memberId: { groupId: postFields.groupId, memberId },
      },
      select: { groupId: true },
    });
    if (!membership) {
      return { ok: false, error: "Not a member of this group", status: 403 };
    }
    groupId = postFields.groupId;
  }

  const content = postFields.content?.trim() || null;
  const photos = (postFields.photos ?? []).filter((p) => typeof p === "string" && p.trim());
  const videos = (postFields.videos ?? []).filter((v) => typeof v === "string" && v.trim());
  const links = (postFields.links ?? [])
    .filter((l) => l?.url?.trim())
    .map((l) => ({ url: l.url!.trim(), title: (l.title ?? "").trim() }));
  const taggedMemberIds = [...new Set((postFields.taggedMemberIds ?? []).filter(Boolean))];
  const tags = (postFields.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const postExtras = {
    content,
    photos,
    videos,
    ...(links.length ? { links } : {}),
    taggedMemberIds,
    groupId,
  };

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
        sourceBusinessId,
        ...postExtras,
      },
    });
    await attachTagsToPosts([post.id], tags);
    return { ok: true, kind: "collection", collectionId: collection.id, postId: post.id, title };
  }

  const posts = await prisma.$transaction(
    ordered.map((storeItemId) =>
      prisma.post.create({
        data: {
          type: "shared_store_item",
          authorId: memberId,
          sourceStoreItemId: storeItemId,
          sourceBusinessId,
          ...postExtras,
        },
      })
    )
  );
  await attachTagsToPosts(
    posts.map((p) => p.id),
    tags
  );
  return { ok: true, kind: "items", postIds: posts.map((p) => p.id) };
}
