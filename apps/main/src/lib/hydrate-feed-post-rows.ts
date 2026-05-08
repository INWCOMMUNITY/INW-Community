import { prisma } from "database";
import type { Prisma } from "database";
import {
  collectTaggedBusinessIdsFromPosts,
  mergePostBusinessLookupIds,
  taggedBusinessesFromIds,
} from "@/lib/feed-tagged-businesses";

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
  const sourceRewardIds = items.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
  const sourceStoreItemIds = items.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
  const sourcePostIds = items.filter((p) => p.sourcePostId).map((p) => p.sourcePostId!);
  const postGroupIds = items.filter((p) => p.groupId).map((p) => p.groupId!);

  const [blogs, businesses, coupons, rewards, storeItems, sourcePosts, groups, likes, likeCounts, commentCounts] =
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
      sourceRewardIds.length > 0
        ? prisma.reward.findMany({
            where: { id: { in: sourceRewardIds } },
            include: { business: { select: { id: true, name: true, slug: true } } },
          })
        : [],
      sourceStoreItemIds.length > 0
        ? prisma.storeItem.findMany({
            where: { id: { in: sourceStoreItemIds } },
            select: { id: true, title: true, slug: true, photos: true, priceCents: true },
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
        select: { postId: true },
      }),
      prisma.postLike.groupBy({
        by: ["postId"],
        where: { postId: { in: postIds } },
        _count: { postId: true },
      }),
      prisma.postComment.groupBy({
        by: ["postId"],
        where: { postId: { in: postIds } },
        _count: { postId: true },
      }),
    ]);

  const blogMap = Object.fromEntries(blogs.map((b) => [b.id, b]));
  const groupMap = Object.fromEntries(groups.map((g) => [g.id, g]));
  const businessMap = Object.fromEntries(businesses.map((b) => [b.id, b]));
  const couponMap = Object.fromEntries(coupons.map((c) => [c.id, c]));
  const rewardMap = Object.fromEntries(rewards.map((r) => [r.id, r]));
  const storeItemMap = Object.fromEntries(storeItems.map((s) => [s.id, s]));

  const sourcePostBlogIds = sourcePosts.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
  const sourcePostBusinessIds = sourcePosts.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
  const sourcePostCouponIds = sourcePosts.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourcePostRewardIds = sourcePosts.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
  const sourcePostStoreItemIds = sourcePosts.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);

  const [sourcePostBlogs, sourcePostBusinesses, sourcePostCoupons, sourcePostRewards, sourcePostStoreItems] =
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
      sourcePostRewardIds.length > 0
        ? prisma.reward.findMany({
            where: { id: { in: sourcePostRewardIds } },
            include: { business: { select: { id: true, name: true, slug: true } } },
          })
        : [],
      sourcePostStoreItemIds.length > 0
        ? prisma.storeItem.findMany({
            where: { id: { in: sourcePostStoreItemIds } },
            select: { id: true, title: true, slug: true, photos: true, priceCents: true },
          })
        : [],
    ]);

  const sourcePostBlogMap = Object.fromEntries(sourcePostBlogs.map((b) => [b.id, b]));
  const sourcePostBusinessMap = Object.fromEntries(sourcePostBusinesses.map((b) => [b.id, b]));
  const sourcePostCouponMap = Object.fromEntries(sourcePostCoupons.map((c) => [c.id, c]));
  const sourcePostRewardMap = Object.fromEntries(sourcePostRewards.map((r) => [r.id, r]));
  const sourcePostStoreItemMap = Object.fromEntries(sourcePostStoreItems.map((s) => [s.id, s]));

  const sourcePostMap = Object.fromEntries(
    sourcePosts.map((p) => [
      p.id,
      {
        ...p,
        tags: p.postTags?.map((pt) => pt.tag) ?? [],
        sourceBlog: p.sourceBlogId
          ? (sourcePostBlogMap[p.sourceBlogId] ?? blogMap[p.sourceBlogId] ?? null)
          : null,
        sourceBusiness: p.sourceBusinessId
          ? (sourcePostBusinessMap[p.sourceBusinessId] ?? businessMap[p.sourceBusinessId] ?? null)
          : null,
        sourceCoupon: p.sourceCouponId
          ? (sourcePostCouponMap[p.sourceCouponId] ?? couponMap[p.sourceCouponId] ?? null)
          : null,
        sourceReward: p.sourceRewardId
          ? (sourcePostRewardMap[p.sourceRewardId] ?? rewardMap[p.sourceRewardId] ?? null)
          : null,
        sourceStoreItem: p.sourceStoreItemId
          ? (sourcePostStoreItemMap[p.sourceStoreItemId] ?? storeItemMap[p.sourceStoreItemId] ?? null)
          : null,
      },
    ])
  );

  const likedSet = new Set(likes.map((l) => l.postId));
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
  const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));

  return items.map((p) => ({
    ...p,
    tags: p.postTags?.map((pt) => pt.tag) ?? [],
    sourceBlog: p.sourceBlogId ? blogMap[p.sourceBlogId] ?? null : null,
    sourceBusiness: p.sourceBusinessId ? businessMap[p.sourceBusinessId] ?? null : null,
    taggedBusinesses: taggedBusinessesFromIds(p.taggedBusinessIds, businessMap),
    sourceCoupon: p.sourceCouponId ? couponMap[p.sourceCouponId] ?? null : null,
    sourceReward: p.sourceRewardId ? rewardMap[p.sourceRewardId] ?? null : null,
    sourceStoreItem: p.sourceStoreItemId ? storeItemMap[p.sourceStoreItemId] ?? null : null,
    sourcePost: p.sourcePostId ? sourcePostMap[p.sourcePostId] ?? null : null,
    sourceGroup: p.groupId ? groupMap[p.groupId] ?? null : null,
    liked: likedSet.has(p.id),
    likeCount: likeCountMap[p.id] ?? 0,
    commentCount: commentCountMap[p.id] ?? 0,
  })) as Array<
    Record<string, unknown> & {
      id: string;
      type: string;
      sourceGroup: { id: string; name: string; slug: string } | null;
    }
  >;
}
