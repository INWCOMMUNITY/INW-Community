import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getFeedExcludedAuthorIds } from "@/lib/member-block";
import { isFeedPostRenderable, type FeedPostLike } from "@/lib/feed-post-visible";
import { hydrateFeedPostRows, feedPostListInclude } from "@/lib/hydrate-feed-post-rows";
import { canViewerSeeFeedItem } from "@/lib/feed-post-viewer-access";

export const dynamic = "force-dynamic";

/**
 * Posts tied to a public business listing: shared_business, or shares of that business's coupons/rewards.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSessionForApi(req);
  const viewerId = session?.user?.id ?? null;
  const { id: businessId } = await ctx.params;

  const business = await prisma.business.findFirst({
    where: { id: businessId, nameApprovalStatus: "approved" },
    select: { id: true },
  });
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  const [couponRows, rewardRows, excludedAuthors] = await Promise.all([
    prisma.coupon.findMany({ where: { businessId: business.id }, select: { id: true } }),
    prisma.reward.findMany({ where: { businessId: business.id }, select: { id: true } }),
    viewerId ? getFeedExcludedAuthorIds(viewerId) : Promise.resolve([] as string[]),
  ]);
  const couponIds = couponRows.map((c) => c.id);
  const rewardIds = rewardRows.map((r) => r.id);

  const orClause: { sourceBusinessId?: string; sourceCouponId?: { in: string[] }; sourceRewardId?: { in: string[] } }[] =
    [{ sourceBusinessId: business.id }];
  if (couponIds.length) orClause.push({ sourceCouponId: { in: couponIds } });
  if (rewardIds.length) orClause.push({ sourceRewardId: { in: rewardIds } });

  const where = {
    OR: orClause,
    ...(excludedAuthors.length > 0 ? { authorId: { notIn: excludedAuthors } } : {}),
  };

  const posts = await prisma.post.findMany({
    where,
    include: feedPostListInclude,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = posts.length > limit;
  const items = hasMore ? posts.slice(0, limit) : posts;

  const hydrated = await hydrateFeedPostRows(items, viewerId ?? "");
  const renderable = hydrated.filter((p) => isFeedPostRenderable(p as unknown as FeedPostLike));

  let feedItemsVisible: typeof renderable;
  if (!viewerId) {
    feedItemsVisible = renderable.filter((p) => {
      if (p.type === "shared_post") {
        const sp = p.sourcePost as { author?: { privacyLevel?: string | null } } | null;
        return (sp?.author?.privacyLevel ?? "public") === "public";
      }
      const auth = p.author as { privacyLevel?: string | null };
      return (auth?.privacyLevel ?? "public") === "public";
    });
  } else {
    const [friendships, myGroups] = await Promise.all([
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
    ]);
    const viewerFriendIdSet = new Set(
      friendships.map((f) => (f.requesterId === viewerId ? f.addresseeId : f.requesterId))
    );
    const viewerGroupIdSet = new Set(myGroups.map((g) => g.groupId));

    feedItemsVisible = renderable.filter((p) =>
      canViewerSeeFeedItem(
        {
          type: p.type as string,
          author: p.author as { id?: string; privacyLevel?: string | null },
          groupId: (p.groupId as string | null) ?? null,
          sourcePost: p.sourcePost as {
            author?: { id?: string; privacyLevel?: string | null };
            groupId?: string | null;
          } | null,
        },
        viewerId,
        viewerFriendIdSet,
        viewerGroupIdSet
      )
    );
  }

  const nextCursor = hasMore ? (feedItemsVisible[feedItemsVisible.length - 1]?.id as string | undefined) : undefined;

  return NextResponse.json({
    posts: feedItemsVisible,
    nextCursor: nextCursor ?? null,
  });
}
