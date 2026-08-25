import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { loadCommunityFeed } from "@/lib/load-community-feed";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10) || 30, 100);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const filter = url.searchParams.get("filter") ?? "all";

  const data = await loadCommunityFeed({
    viewerId: session?.user?.id ?? null,
    limit,
    cursor,
    filter,
  });

  return NextResponse.json(
    { posts: data.posts, nextCursor: data.nextCursor },
    data.cacheControl ? { headers: { "Cache-Control": data.cacheControl } } : undefined
  );
}
