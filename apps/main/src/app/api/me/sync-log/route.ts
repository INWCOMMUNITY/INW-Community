import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/sync-log — returns the seller's most recent channel sync events.
 * Query params:
 *   limit  — max rows (default 50, max 100)
 *   cursor — createdAt ISO string for pagination (returns events older than this)
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1),
    100
  );
  const cursor = req.nextUrl.searchParams.get("cursor");
  const storeItemId = req.nextUrl.searchParams.get("storeItemId")?.trim() || null;

  try {
    const events = await prisma.channelSyncLog.findMany({
      where: {
        memberId: session.user.id,
        ...(storeItemId ? { storeItemId } : {}),
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        provider: true,
        storeItemId: true,
        action: true,
        detail: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      events,
      nextCursor: events.length === limit ? events[events.length - 1].createdAt.toISOString() : null,
    });
  } catch (e) {
    console.error("[sync-log] fetch failed", { error: String(e) });
    return NextResponse.json({ events: [], nextCursor: null });
  }
}
