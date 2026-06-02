import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * DELETE: disconnect a channel.
 * Default: remove connection + links; StoreItems stay on INW; external marketplace listings stay.
 * ?deleteInwItems=1: also delete StoreItems that were linked to this connection (not on the marketplace).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const deleteInwItems =
    new URL(req.url).searchParams.get("deleteInwItems") === "1" ||
    new URL(req.url).searchParams.get("deleteInwItems") === "true";

  const conn = await prisma.channelConnection.findUnique({ where: { id } });
  if (!conn || conn.memberId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: id },
    select: { storeItemId: true },
  });
  const storeItemIds = [...new Set(links.map((l) => l.storeItemId))];

  // Cascade removes listing links. Do not call deleteStoreItemFromChannels — external listings stay.
  await prisma.channelConnection.delete({ where: { id } });

  let deletedInwCount = 0;
  if (deleteInwItems) {
    for (const storeItemId of storeItemIds) {
      try {
        await prisma.storeItem.delete({ where: { id: storeItemId, memberId: userId } });
        deletedInwCount += 1;
      } catch (e) {
        console.error("[channels] disconnect deleteInwItems failed", {
          storeItemId,
          error: String(e),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    deleteInwItems,
    deletedInwCount,
    keptInwCount: deleteInwItems ? 0 : storeItemIds.length,
  });
}
