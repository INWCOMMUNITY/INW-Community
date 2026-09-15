import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  exclusiveAndSharedIds,
  parseDeleteInwMode,
  storeItemIdsToDelete,
} from "@/lib/channels/disconnect-inw-items";
import {
  releaseRemoteChannelBindings,
  tryDecryptChannelToken,
  wipeDisconnectedChannel,
} from "@/lib/channels/disconnect-channel";

export const dynamic = "force-dynamic";

/**
 * DELETE: disconnect a channel.
 * Default: keep INW StoreItems; wipe tokens, listing links, retries, and remote webhooks.
 * Marketplace listings stay. Sync must not keep writing after this returns.
 * ?deleteInwItems=exclusive: delete INW items linked only to this store.
 * ?deleteInwItems=1: delete all INW items linked to this store, including ones also on other stores.
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
  const deleteMode = parseDeleteInwMode(new URL(req.url).searchParams.get("deleteInwItems"));

  const conn = await prisma.channelConnection.findUnique({ where: { id } });
  if (!conn || conn.memberId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = tryDecryptChannelToken(conn.accessTokenEncrypted);
  let remoteReleased = false;
  if (token) {
    const remote = await releaseRemoteChannelBindings({
      provider: conn.provider,
      accessToken: token,
      config: conn.config,
      externalShopId: conn.externalShopId,
    });
    remoteReleased = remote.ok;
    if (!remote.ok) {
      console.warn("[channels] disconnect remote release failed", {
        connectionId: id,
        provider: conn.provider,
        error: remote.error,
      });
    }
  }

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: id },
    select: { storeItemId: true },
  });
  const storeItemIds = [...new Set(links.map((l) => l.storeItemId))];

  const otherLiveLinks =
    storeItemIds.length === 0
      ? []
      : await prisma.channelListingLink.findMany({
          where: {
            storeItemId: { in: storeItemIds },
            connectionId: { not: id },
            connection: { status: { not: "disconnected" } },
          },
          select: { storeItemId: true },
        });
  const otherLiveItemIds = new Set(otherLiveLinks.map((l) => l.storeItemId));
  const { exclusiveIds, sharedIds } = exclusiveAndSharedIds(storeItemIds, otherLiveItemIds);
  const idsToDelete = storeItemIdsToDelete(deleteMode, exclusiveIds, storeItemIds);

  let deletedInwCount = 0;
  for (const storeItemId of idsToDelete) {
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

  const wiped = await wipeDisconnectedChannel(id, {
    memberId: conn.memberId,
    provider: conn.provider,
  });

  const keptInwCount = storeItemIds.length - deletedInwCount;

  return NextResponse.json({
    ok: true,
    deleteInwItems: deleteMode === "all",
    deleteMode,
    deletedInwCount,
    keptInwCount,
    exclusiveCount: exclusiveIds.length,
    sharedCount: sharedIds.length,
    linksDeleted: wiped.linksDeleted,
    remoteReleased,
  });
}
