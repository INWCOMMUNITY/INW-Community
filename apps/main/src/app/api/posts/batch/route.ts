import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { hydrateFeedPostRows, feedPostListInclude } from "@/lib/hydrate-feed-post-rows";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ids = req.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean);
  if (!ids?.length) {
    return NextResponse.json({ posts: [] });
  }

  const MAX_BATCH = 50;
  const truncatedIds = ids.slice(0, MAX_BATCH);

  const rows = await prisma.post.findMany({
    where: { id: { in: truncatedIds } },
    include: feedPostListInclude,
    orderBy: { createdAt: "desc" },
  });

  const posts = await hydrateFeedPostRows(rows, session.user.id);

  return NextResponse.json({ posts });
}
