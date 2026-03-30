import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getFeedExcludedAuthorIds } from "@/lib/member-block";
import { isFeedPostRenderable } from "@/lib/feed-post-visible";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  // Unauthenticated: return a public discover feed (recent posts, no groups)
  if (!session || !session.user.id) {
    const where = { groupId: null };
    const posts = await prisma.post.findMany({
      where,
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true, privacyLevel: true },
        },
        postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = posts.length > limit;
    const items = (hasMore ? posts.slice(0, limit) : posts).filter((p) => p.author?.privacyLevel === "public");
    const nextCursor = hasMore ? items[items.length - 1]?.id : null;
    const postIds = items.map((p) => p.id);
    const sourceBlogIds = items.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
    const sourceBusinessIds = items.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
    const sourceCouponIds = items.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
    const sourceRewardIds = items.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
    const sourceStoreItemIds = items.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
    const sourcePostIds = items.filter((p) => p.sourcePostId).map((p) => p.sourcePostId!);
    const [blogs, businesses, coupons, rewards, storeItems, sourcePosts] = await Promise.all([
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
      sourceBusinessIds.length > 0
        ? prisma.business.findMany({
            where: { id: { in: sourceBusinessIds } },
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
                select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true, privacyLevel: true },
              },
              postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
            },
          })
        : [],
    ]);
    const blogMap = Object.fromEntries(blogs.map((b) => [b.id, b]));
    const businessMap = Object.fromEntries(businesses.map((b) => [b.id, b]));
    const couponMap = Object.fromEntries(coupons.map((c) => [c.id, c]));
    const rewardMap = Object.fromEntries(rewards.map((r) => [r.id, r]));
    const storeItemMap = Object.fromEntries(storeItems.map((s) => [s.id, s]));
    const sourcePostMap = Object.fromEntries(
      sourcePosts.map((p) => [
        p.id,
        {
          ...p,
          tags: p.postTags?.map((pt) => pt.tag) ?? [],
          sourceBlog: null,
          sourceBusiness: p.sourceBusinessId ? businessMap[p.sourceBusinessId] ?? null : null,
          sourceCoupon: p.sourceCouponId ? couponMap[p.sourceCouponId] ?? null : null,
          sourceReward: p.sourceRewardId ? rewardMap[p.sourceRewardId] ?? null : null,
          sourceStoreItem: p.sourceStoreItemId ? storeItemMap[p.sourceStoreItemId] ?? null : null,
          sourcePost: null,
        },
      ])
    );
    const [likeCounts, commentCounts] = await Promise.all([
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
    const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
    const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));
    const feedItems = items
      .map((p) => ({
        ...p,
        tags: p.postTags?.map((pt) => pt.tag) ?? [],
        sourceBlog: p.sourceBlogId ? blogMap[p.sourceBlogId] ?? null : null,
        sourceBusiness: p.sourceBusinessId ? businessMap[p.sourceBusinessId] ?? null : null,
        sourceCoupon: p.sourceCouponId ? couponMap[p.sourceCouponId] ?? null : null,
        sourceReward: p.sourceRewardId ? rewardMap[p.sourceRewardId] ?? null : null,
        sourceStoreItem: p.sourceStoreItemId ? storeItemMap[p.sourceStoreItemId] ?? null : null,
        sourcePost: p.sourcePostId ? sourcePostMap[p.sourcePostId] ?? null : null,
        liked: false,
        likeCount: likeCountMap[p.id] ?? 0,
        commentCount: commentCountMap[p.id] ?? 0,
      }))
      .filter(isFeedPostRenderable)
      .filter((p) => p.type !== "shared_post" || p.sourcePost?.author?.privacyLevel === "public");
    return NextResponse.json({ posts: feedItems, nextCursor });
  }

  const viewerId = session.user.id;

  const [followBusinesses, friendships, myGroups, followedTags, excludedAuthors] = await Promise.all([
    prisma.followBusiness.findMany({
      where: { memberId: viewerId },
      select: { business: { select: { memberId: true } } },
    }),
    prisma.friendRequest.findMany({
      where: {
        OR: [
          { requesterId: viewerId, status: "accepted" },
          { addresseeId: viewerId, status: "accepted" },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    }),
    prisma.groupMember.findMany({
      where: { memberId: viewerId },
      select: { groupId: true },
    }),
    prisma.followTag.findMany({
      where: { memberId: viewerId },
      select: { tagId: true },
    }),
    getFeedExcludedAuthorIds(viewerId),
  ]);
  const blockedIds = excludedAuthors;

  const followBusinessAuthorIds = followBusinesses
    .map((fb) => fb.business?.memberId)
    .filter(Boolean) as string[];
  const friendIds = [...new Set(
    friendships.flatMap((f) =>
      f.requesterId === viewerId ? f.addresseeId : f.requesterId
    )
  )];
  const groupIds = myGroups.map((g) => g.groupId);
  const viewerFriendIdSet = new Set(friendIds);
  const viewerGroupIdSet = new Set(groupIds);
  const authorIds = new Set([viewerId, ...friendIds, ...followBusinessAuthorIds]);
  const followedTagIds = followedTags.map((f) => f.tagId);

  let sharedBlogIdsWithFollowedTags: string[] = [];
  if (followedTagIds.length > 0) {
    const blogsWithTags = await prisma.blog.findMany({
      where: {
        blogTags: { some: { tagId: { in: followedTagIds } } },
      },
      select: { id: true },
    });
    sharedBlogIdsWithFollowedTags = blogsWithTags.map((b) => b.id);
  }

  const visibilityOr = [
    { authorId: { in: Array.from(authorIds) } },
    ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
    ...(followedTagIds.length > 0
      ? [
          { postTags: { some: { tagId: { in: followedTagIds } } } },
          ...(sharedBlogIdsWithFollowedTags.length > 0
            ? [{ sourceBlogId: { in: sharedBlogIdsWithFollowedTags } }]
            : []),
        ]
      : []),
  ] as const;

  const baseWhere = {
    ...(blockedIds.length > 0 ? { authorId: { notIn: blockedIds } } : {}),
    OR: [...visibilityOr],
  };

  const followBizAuthorSet = new Set(followBusinessAuthorIds);
  const boostedOr = [
    {
      authorId: {
        in: [viewerId, ...friendIds, ...followBusinessAuthorIds],
      },
    },
    ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
    ...(followedTagIds.length > 0
      ? [
          { postTags: { some: { tagId: { in: followedTagIds } } } },
          ...(sharedBlogIdsWithFollowedTags.length > 0
            ? [{ sourceBlogId: { in: sharedBlogIdsWithFollowedTags } }]
            : []),
        ]
      : []),
  ];

  const postInclude = {
    author: {
      select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true, privacyLevel: true },
    },
    postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
  } as const;

  const RANK_FETCH = 200;
  const boostedPosts = await prisma.post.findMany({
    where: { AND: [baseWhere, { OR: boostedOr }] },
    include: postInclude,
    orderBy: { createdAt: "desc" },
    take: RANK_FETCH,
  });
  const boostedIdSet = new Set(boostedPosts.map((p) => p.id));
  const restPosts = await prisma.post.findMany({
    where: {
      AND: [baseWhere, { id: { notIn: [...boostedIdSet] } }],
    },
    include: postInclude,
    orderBy: { createdAt: "desc" },
    take: RANK_FETCH,
  });

  const mergedById = new Map<string, (typeof boostedPosts)[0]>();
  for (const p of boostedPosts) mergedById.set(p.id, p);
  for (const p of restPosts) mergedById.set(p.id, p);
  const mergedList = [...mergedById.values()];

  function rankScore(p: (typeof mergedList)[0]): number {
    const t = new Date(p.createdAt).getTime();
    const aid = p.authorId;
    if (aid === viewerId || viewerFriendIdSet.has(aid) || followBizAuthorSet.has(aid)) {
      return 3e15 + t;
    }
    if (p.groupId && viewerGroupIdSet.has(p.groupId)) return 2e15 + t;
    if (
      followedTagIds.length > 0 &&
      p.postTags?.some((pt) => followedTagIds.includes(pt.tag.id))
    ) {
      return 2e15 + t;
    }
    if (
      p.sourceBlogId &&
      sharedBlogIdsWithFollowedTags.includes(p.sourceBlogId)
    ) {
      return 2e15 + t;
    }
    return 1e15 + t;
  }

  mergedList.sort((a, b) => rankScore(b) - rankScore(a));

  let startIdx = 0;
  if (cursor) {
    const ci = mergedList.findIndex((p) => p.id === cursor);
    startIdx = ci >= 0 ? ci + 1 : 0;
  }

  const OVERSHOOT = 28;
  const items = mergedList.slice(startIdx, startIdx + limit + OVERSHOOT);

  const postIds = items.map((p) => p.id);
  const sourceBlogIds = items.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
  const sourceBusinessIds = items.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
  const sourceCouponIds = items.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourceRewardIds = items.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
  const sourceStoreItemIds = items.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);
  const sourcePostIds = items.filter((p) => p.sourcePostId).map((p) => p.sourcePostId!);
  const postGroupIds = items.filter((p) => p.groupId).map((p) => p.groupId!);

  const [blogs, businesses, coupons, rewards, storeItems, sourcePosts, groups] = await Promise.all([
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
    sourceBusinessIds.length > 0
      ? prisma.business.findMany({
          where: { id: { in: sourceBusinessIds } },
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
              select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true, privacyLevel: true },
            },
            postTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
          },
        })
      : [],
    postGroupIds.length > 0
      ? prisma.group.findMany({
          where: { id: { in: postGroupIds } },
          select: { id: true, name: true, slug: true },
        })
      : [],
  ]);

  const blogMap = Object.fromEntries(blogs.map((b) => [b.id, b]));
  const groupMap = Object.fromEntries((groups as { id: string; name: string; slug: string }[]).map((g) => [g.id, g]));
  const businessMap = Object.fromEntries(businesses.map((b) => [b.id, b]));
  const couponMap = Object.fromEntries(coupons.map((c) => [c.id, c]));
  const rewardMap = Object.fromEntries(rewards.map((r) => [r.id, r]));
  const storeItemMap = Object.fromEntries(storeItems.map((s) => [s.id, s]));

  const sourcePostBlogIds = sourcePosts.filter((p) => p.sourceBlogId).map((p) => p.sourceBlogId!);
  const sourcePostBusinessIds = sourcePosts.filter((p) => p.sourceBusinessId).map((p) => p.sourceBusinessId!);
  const sourcePostCouponIds = sourcePosts.filter((p) => p.sourceCouponId).map((p) => p.sourceCouponId!);
  const sourcePostRewardIds = sourcePosts.filter((p) => p.sourceRewardId).map((p) => p.sourceRewardId!);
  const sourcePostStoreItemIds = sourcePosts.filter((p) => p.sourceStoreItemId).map((p) => p.sourceStoreItemId!);

  const [sourcePostBlogs, sourcePostBusinesses, sourcePostCoupons, sourcePostRewards, sourcePostStoreItems] = await Promise.all([
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
        sourceBlog: p.sourceBlogId ? (sourcePostBlogMap[p.sourceBlogId] ?? blogMap[p.sourceBlogId] ?? null) : null,
        sourceBusiness: p.sourceBusinessId ? (sourcePostBusinessMap[p.sourceBusinessId] ?? businessMap[p.sourceBusinessId] ?? null) : null,
        sourceCoupon: p.sourceCouponId ? (sourcePostCouponMap[p.sourceCouponId] ?? couponMap[p.sourceCouponId] ?? null) : null,
        sourceReward: p.sourceRewardId ? (sourcePostRewardMap[p.sourceRewardId] ?? rewardMap[p.sourceRewardId] ?? null) : null,
        sourceStoreItem: p.sourceStoreItemId ? (sourcePostStoreItemMap[p.sourceStoreItemId] ?? storeItemMap[p.sourceStoreItemId] ?? null) : null,
      },
    ])
  );

  const [likes, likeCounts, commentCounts] = await Promise.all([
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
  const likedSet = new Set(likes.map((l) => l.postId));
  const likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.postId, l._count.postId]));
  const commentCountMap = Object.fromEntries(commentCounts.map((c) => [c.postId, c._count.postId]));

  const feedItems = items
    .map((p) => ({
      ...p,
      tags: p.postTags?.map((pt) => pt.tag) ?? [],
      sourceBlog: p.sourceBlogId ? blogMap[p.sourceBlogId] ?? null : null,
      sourceBusiness: p.sourceBusinessId ? businessMap[p.sourceBusinessId] ?? null : null,
      sourceCoupon: p.sourceCouponId ? couponMap[p.sourceCouponId] ?? null : null,
      sourceReward: p.sourceRewardId ? rewardMap[p.sourceRewardId] ?? null : null,
      sourceStoreItem: p.sourceStoreItemId ? storeItemMap[p.sourceStoreItemId] ?? null : null,
      sourcePost: p.sourcePostId ? sourcePostMap[p.sourcePostId] ?? null : null,
      sourceGroup: p.groupId ? groupMap[p.groupId] ?? null : null,
      liked: likedSet.has(p.id),
      likeCount: likeCountMap[p.id] ?? 0,
      commentCount: commentCountMap[p.id] ?? 0,
    }))
    .filter(isFeedPostRenderable);

  const feedItemsVisible = feedItems.filter((p) => {
    if (!p.author?.id) return false;

    // Shared post visibility is driven by the *source post author privacy*,
    // not by the sharer's feed-post metadata.
    if (p.type === "shared_post") {
      const sourcePost = p.sourcePost;
      if (!sourcePost?.author?.id) return false;

      const sourceAuthorId = sourcePost.author.id as string;
      const sourcePrivacyLevel = sourcePost.author.privacyLevel as string;
      const sourceGroupId = (sourcePost.groupId as string | null) ?? null;

      // Posts originating from a group are visible to members of that group.
      if (sourceGroupId && viewerGroupIdSet.has(sourceGroupId)) return true;

      if (sourcePrivacyLevel === "public") return true;
      if (sourcePrivacyLevel === "friends_only") {
        return sourceAuthorId === viewerId || viewerFriendIdSet.has(sourceAuthorId);
      }
      if (sourcePrivacyLevel === "completely_private") {
        return sourceAuthorId === viewerId;
      }
      return false;
    }

    // Normal (non-shared) posts: group posts are visible to members of that group.
    const postGroupId = (p.groupId as string | null) ?? null;
    if (postGroupId && viewerGroupIdSet.has(postGroupId)) return true;

    const authorId = p.author.id as string;
    const privacyLevel = (p.author.privacyLevel as string) ?? "public";

    if (privacyLevel === "public") return true;
    if (privacyLevel === "friends_only") {
      return authorId === viewerId || viewerFriendIdSet.has(authorId);
    }
    if (privacyLevel === "completely_private") {
      return authorId === viewerId;
    }
    return false;
  });

  const visibleWindow = feedItemsVisible.slice(0, limit + 1);
  const hasMoreVisible = visibleWindow.length > limit;
  const postsOut = hasMoreVisible ? visibleWindow.slice(0, limit) : visibleWindow;
  const nextCursor = hasMoreVisible ? postsOut[postsOut.length - 1]?.id ?? null : null;

  return NextResponse.json({
    posts: postsOut,
    nextCursor,
  });
}
