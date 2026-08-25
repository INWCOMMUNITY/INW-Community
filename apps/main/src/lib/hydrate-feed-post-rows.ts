import { prisma } from "database";
import type { Prisma } from "database";
import {
  collectTaggedBusinessIdsFromPosts,
  mergePostBusinessLookupIds,
  taggedBusinessesFromIds,
} from "@/lib/feed-tagged-businesses";
import { getShareCountBySourcePostId } from "@/lib/post-share-counts";
import { storeItemRowsToFeedEmbedMap } from "@/lib/store-item-variants";
import { listingCollectionEmbedMap, listingCollectionIdsFromPosts } from "@/lib/listing-feed-collection";
import {
  listingSellerBusinessMapForPosts,
  resolveFeedPostSourceBusiness,
} from "@/lib/listing-feed-seller-business";

/** Matches feed / group-feed includes for hydration + API responses. */
export const feedPostListInclude = {
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      privacyLevel: true,
    },
  },
  postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
} satisfies Prisma.PostInclude;

export type FeedPostRow = Prisma.PostGetPayload<{ include: typeof feedPostListInclude }>;

/**
 * Expand source blogs/businesses/… and nested shared_post sources; attach like/comment counts.
 */
export async function hydrateFeedPostRows(
  items: FeedPostRow[],
  viewerId: string
): Promise<
  Array<
    Record<string, unknown> & {
      id: string;
      type: string;
      sourceGroup: { id: string; name: string; slug: string } | null;
    }
  >
> {
  if (items.length === 0) return [];

  const postIds = items.map((p) => p.id);
  const sourceBlogIds = items.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
  const sourceBusinessIds = items.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
  const taggedBizFlat = collectTaggedBusinessIdsFromPosts(items);
  const businessLookupIds = mergePostBusinessLookupIds(sourceBusinessIds, taggedBizFlat);
  const sourceCouponIds = items.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourceStoreItemIds = items.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
  const sourceEventIds = items.filter((p) => p.sourceEventId).map((p) => p.sourceEventId!);
  const sourcePostIds = items.filter((p) => p.sourcePostId).map((p) => p.sourcePostId!);
  const postGroupIds = items.filter((p) => p.groupId).map((p) => p.groupId!);

  const [blogs, businesses, coupons, storeItems, events, sourcePosts, groups, likes, likeCounts, reactionCounts, commentCounts, shareCountMap, polls, viewerVotes, viewerFollows] =
    await Promise.all([
      sourceBlogIds.length > 0
        ? prisma.blog.findMany({
            where: { id: { in: sourceBlogIds } },
            include: {
              member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
              category: { select: { name: true, slug: true } },
              blogTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
            },
          })
        : [],
      businessLookupIds.length > 0
        ? prisma.business.findMany({
            where: { id: { in: businessLookupIds } },
            select: { id: true, name: true, slug: true, shortDescription: true, logoUrl: true },
          })
        : [],
      sourceCouponIds.length > 0
        ? prisma.coupon.findMany({
            where: { id: { in: sourceCouponIds } },
            include: { business: { select: { id: true, name: true, slug: true } } },
          })
        : [],
      sourceStoreItemIds.length > 0
        ? prisma.storeItem.findMany({
            where: { id: { in: sourceStoreItemIds } },
            select: { id: true, title: true, slug: true, photos: true, priceCents: true, status: true, quantity: true, memberId: true },
          })
        : [],
      sourceEventIds.length > 0
        ? prisma.event.findMany({
            where: { id: { in: sourceEventIds } },
            select: {
              id: true,
              slug: true,
              title: true,
              date: true,
              time: true,
              endTime: true,
              location: true,
              city: true,
              photos: true,
            },
          })
        : [],
      sourcePostIds.length > 0
        ? prisma.post.findMany({
            where: { id: { in: sourcePostIds } },
            include: {
              author: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  profilePhotoUrl: true,
                  privacyLevel: true,
                },
              },
              postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
            },
          })
        : [],
      postGroupIds.length > 0
        ? prisma.group.findMany({
            where: { id: { in: [...new Set(postGroupIds)] } },
            select: { id: true, name: true, slug: true },
          })
        : [],
      prisma.postLike.findMany({
        where: { postId: { in: postIds }, memberId: viewerId },
        select: { postId: true, reaction: true },
      }),
      prisma.postLike.groupBy({
        by: ["postId"],
        where: { postId: { in: postIds } },
        _count: { postId: true },
      }),
      prisma.postLike.groupBy({
        by: ["postId", "reaction"],
        where: { postId: { in: postIds } },
        _count: { postId: true },
      }),
      prisma.postComment.groupBy({
        by: ["postId"],
        where: { postId: { in: postIds } },
        _count: { postId: true },
      }),
      getShareCountBySourcePostId(postIds),
      prisma.postPoll.findMany({
        where: { postId: { in: postIds } },
        include: {
          options: {
            include: {
              _count: { select: { votes: true } },
            },
          },
        },
      }),
      prisma.postPollVote.findMany({
        where: { memberId: viewerId, option: { poll: { postId: { in: postIds } } } },
        select: { optionId: true, option: { select: { pollId: true } } },
      }),
      // Get follow status for all post authors
      (async () => {
        const authorIds = [...new Set(items.map((p) => p.authorId).filter((id) => id !== viewerId))];
        if (authorIds.length === 0) return [];
        try {
          return await prisma.follow.findMany({
            where: {
              followerId: viewerId,
              followingId: { in: authorIds },
            },
            select: { followingId: true },
          });
        } catch {
          return [];
        }
      })(),
    ]);

  const blogMap = Object.fromEntries(blogs.map((b) => [b.id, b]));
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g]));
  const businessMap = Object.fromEntries(businesses.map((b) => [b.id, b]));
  const couponMap = Object.fromEntries(coupons.map((c) => [c.id, c]));
  const eventMap = Object.fromEntries(events.map((e) => [e.id, e]));

  const sourcePostBlogIds = sourcePosts.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
  const sourcePostBusinessIds = sourcePosts.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
  const sourcePostCouponIds = sourcePosts.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourcePostStoreItemIds = sourcePosts.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
  const sourcePostEventIds = sourcePosts.filter((p) => p.sourceEventId).map((p) => p.sourceEventId!);

  const [sourcePostBlogs, sourcePostBusinesses, sourcePostCoupons, sourcePostStoreItems, sourcePostEvents, listingCollectionMap] =
    await Promise.all([
      sourcePostBlogIds.length > 0
        ? prisma.blog.findMany({
            where: { id: { in: sourcePostBlogIds } },
            include: {
              member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
              category: { select: { name: true, slug: true } },
              blogTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
            },
          })
        : [],
      sourcePostBusinessIds.length > 0
        ? prisma.business.findMany({
            where: { id: { in: sourcePostBusinessIds } },
            select: { id: true, name: true, slug: true, shortDescription: true, logoUrl: true },
          })
        : [],
      sourcePostCouponIds.length > 0
        ? prisma.coupon.findMany({
            where: { id: { in: sourcePostCouponIds } },
            include: { business: { select: { id: true, name: true, slug: true } } },
          })
        : [],
      sourcePostStoreItemIds.length > 0
        ? prisma.storeItem.findMany({
            where: { id: { in: sourcePostStoreItemIds } },
            select: { id: true, title: true, slug: true, photos: true, priceCents: true, status: true, quantity: true, memberId: true },
          })
        : [],
      sourcePostEventIds.length > 0
        ? prisma.event.findMany({
            where: { id: { in: sourcePostEventIds } },
            select: {
              id: true,
              slug: true,
              title: true,
              date: true,
              time: true,
              endTime: true,
              location: true,
              city: true,
              photos: true,
            },
          })
        : [],
      listingCollectionEmbedMap(listingCollectionIdsFromPosts([...items, ...sourcePosts])),
    ]);

  const storeItemMerge = new Map<string, (typeof storeItems)[0]>();
  for (const s of storeItems) storeItemMerge.set(s.id, s);
  for (const s of sourcePostStoreItems) storeItemMerge.set(s.id, s);
  const feedStoreItemMap = storeItemRowsToFeedEmbedMap([...storeItemMerge.values()]);

  const sourcePostBlogMap = Object.fromEntries(sourcePostBlogs.map((b) => [b.id, b]));
  const sourcePostBusinessMap = Object.fromEntries(sourcePostBusinesses.map((b) => [b.id, b]));
  const sourcePostCouponMap = Object.fromEntries(sourcePostCoupons.map((c) => [c.id, c]));
  const sourcePostEventMap = Object.fromEntries(sourcePostEvents.map((e) => [e.id, e]));
  const listingBizByMember = await listingSellerBusinessMapForPosts(
    [...items, ...sourcePosts],
    [...storeItemMerge.values()]
  );
  const businessById = { ...businessMap, ...sourcePostBusinessMap };

  const sourcePostMap = Object.fromEntries(
    sourcePosts.map((p) => [
      p.id,
      {
        ...p,
        tags: p.postTags?.map((pt) => pt.tag) ?? [],
        sourceBlog: p.sourceBlogId
          ? (sourcePostBlogMap[p.sourceBlogId] ?? blogMap[p.sourceBlogId] ?? null)
          : null,
        sourceBusiness: resolveFeedPostSourceBusiness(p, businessById, listingBizByMember),
        sourceCoupon: p.sourceCouponId
          ? (sourcePostCouponMap[p.sourceCouponId] ?? couponMap[p.sourceCouponId] ?? null)
          : null,
        sourceStoreItem: p.sourceStoreItemId
          ? (feedStoreItemMap[p.sourceStoreItemId] ?? null)
          : null,
        sourceEvent: p.sourceEventId
          ? (sourcePostEventMap[p.sourceEventId] ?? eventMap[p.sourceEventId] ?? null)
          : null,
        sourceListingCollection: p.sourceListingCollectionId
          ? (listingCollectionMap[p.sourceListingCollectionId] ?? null)
          : null,
      },
    ])
  );

  const likedSet = new Set(likes.map((l) => l.postId));
  const viewerReactionMap = new Map(
    likes.filter((l) => l.reaction).map((l) => [l.postId, l.reaction])
  );
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
  const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));

  // Reaction breakdown by type (e.g., { postId: { leaf: 5, love: 3 } })
  const reactionBreakdownMap = new Map<string, Record<string, number>>();
  for (const rc of reactionCounts) {
    if (!rc.reaction) continue;
    const existing = reactionBreakdownMap.get(rc.postId) ?? {};
    existing[rc.reaction] = rc._count?.postId ?? 0;
    reactionBreakdownMap.set(rc.postId, existing);
  }

  // Set of member IDs the viewer follows
  const followingSet = new Set(viewerFollows.map((f) => f.followingId));

  // Build poll map with vote counts and viewer's vote
  const viewerVoteByPollId = new Map<string, string>();
  for (const v of viewerVotes) {
    viewerVoteByPollId.set(v.option.pollId, v.optionId);
  }

  const pollMap = new Map<string, {
    question: string;
    options: { id: string; label: string; voteCount: number }[];
    totalVotes: number;
    myVote?: string;
  }>();
  for (const poll of polls) {
    const options = poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      voteCount: o._count.votes,
    }));
    const totalVotes = options.reduce((sum, o) => sum + o.voteCount, 0);
    pollMap.set(poll.postId, {
      question: poll.question,
      options,
      totalVotes,
      myVote: viewerVoteByPollId.get(poll.id),
    });
  }

  return items.map((p) => ({
    ...p,
    tags: p.postTags?.map((pt) => pt.tag) ?? [],
    sourceBlog: p.sourceBlogId ? blogMap[p.sourceBlogId] ?? null : null,
    sourceBusiness: resolveFeedPostSourceBusiness(p, businessById, listingBizByMember),
    taggedBusinesses: taggedBusinessesFromIds(p.taggedBusinessIds, businessMap),
    sourceCoupon: p.sourceCouponId ? couponMap[p.sourceCouponId] ?? null : null,
    sourceStoreItem: p.sourceStoreItemId ? feedStoreItemMap[p.sourceStoreItemId] ?? null : null,
    sourceEvent: p.sourceEventId ? eventMap[p.sourceEventId] ?? null : null,
    sourceListingCollection: p.sourceListingCollectionId
      ? listingCollectionMap[p.sourceListingCollectionId] ?? null
      : null,
    sourcePost: p.sourcePostId ? sourcePostMap[p.sourcePostId] ?? null : null,
    sourceGroup: p.groupId ? groupMap[p.groupId] ?? null : null,
    liked: likedSet.has(p.id),
    myReaction: viewerReactionMap.get(p.id) ?? null,
    likeCount: likeCountMap[p.id] ?? 0,
    reactionBreakdown: reactionBreakdownMap.get(p.id) ?? null,
    commentCount: commentCountMap[p.id] ?? 0,
    shareCount: shareCountMap[p.id] ?? 0,
    poll: pollMap.get(p.id) ?? null,
    isFollowingAuthor: followingSet.has(p.authorId),
  })) as Array<
    Record<string, unknown> & {
      id: string;
      type: string;
      sourceGroup: { id: string; name: string; slug: string } | null;
    }
  >;
}
