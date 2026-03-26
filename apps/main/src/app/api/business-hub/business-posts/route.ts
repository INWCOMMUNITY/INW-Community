import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { hasBusinessHubAccess } from "@/lib/business-hub-access";
import { hydrateFeedPostRows, feedPostListInclude } from "@/lib/hydrate-feed-post-rows";
import { isFeedPostRenderable } from "@/lib/feed-post-visible";

export const dynamic = "force-dynamic";

/**
 * GET /api/business-hub/business-posts?limit=30&cursor=...
 * Business posts (shared_business) authored by the member for their owned businesses.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const allowed = await hasBusinessHubAccess(session.user.id);
  if (!allowed) {
    return NextResponse.json({ error: "Business Hub access required" }, { status: 403 });
  }

  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  const businesses = await prisma.business.findMany({
    where: { memberId: session.user.id },
    select: { id: true },
  });
  const businessIds = businesses.map((b) => b.id);
  if (businessIds.length === 0) {
    return NextResponse.json({ posts: [], nextCursor: null });
  }

  const posts = await prisma.post.findMany({
    where: {
      authorId: session.user.id,
      type: "shared_business",
      sourceBusinessId: { in: businessIds },
    },
    include: feedPostListInclude,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = posts.length > limit;
  const items = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;

  const hydrated = await hydrateFeedPostRows(items, session.user.id);
  const feedItems = hydrated.filter((p) =>
    isFeedPostRenderable(p as unknown as Parameters<typeof isFeedPostRenderable>[0])
  );

  return NextResponse.json({
    posts: feedItems,
    nextCursor,
  });
}
