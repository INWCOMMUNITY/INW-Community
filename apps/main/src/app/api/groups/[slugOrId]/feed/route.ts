import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getFeedExcludedAuthorIds } from "@/lib/member-block";
import { verifiedMemberWhere } from "@/lib/member-public-visibility";
import {
  feedPostListInclude,
  hydrateFeedPostRows,
} from "@/lib/hydrate-feed-post-rows";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slugOrId } = await params;
  const limit = Math.min(parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;

  const group = await prisma.group.findFirst({
    where: isCuid(slugOrId) ? { id: slugOrId } : { slug: slugOrId },
    select: { id: true, name: true, slug: true },
  });
  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const [membership, excludedAuthors] = await Promise.all([
    prisma.groupMember.findUnique({
      where: {
        groupId_memberId: { groupId: group.id, memberId: session.user.id },
      },
    }),
    getFeedExcludedAuthorIds(session.user.id),
  ]);
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this group" }, { status: 403 });
  }

  const blockedIds = excludedAuthors;
  const where = {
    groupId: group.id,
    author: verifiedMemberWhere,
    ...(blockedIds.length > 0 ? { authorId: { notIn: blockedIds } } : {}),
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
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;

  const feedItems = await hydrateFeedPostRows(items, session.user.id);

  return NextResponse.json({
    posts: feedItems,
    nextCursor,
  });
}
