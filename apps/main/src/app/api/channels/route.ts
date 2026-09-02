import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { connectionReadyToPublish, publishBlockReason } from "@/lib/channels/connection-publish";
import { countLinkedOverlap } from "@/lib/channels/disconnect-inw-items";
import { CHANNEL_SALES_FULFILL_NOTE, connectionHealthUx } from "@/lib/channels/pause-reason";
import { ebayPhotoHostFamilyShopSummary, isEbayPhotoHostFamilySyncError } from "@/lib/channels/ebay/errors";

export const dynamic = "force-dynamic";

/** GET: list the current member's channel connections (sanitized; never returns tokens). */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await prisma.channelConnection.findMany({
    where: { memberId: userId },
    select: {
      id: true,
      provider: true,
      externalShopId: true,
      externalShopName: true,
      status: true,
      lastError: true,
      etsyShippingProfileId: true,
      config: true,
      lastReconciledAt: true,
      createdAt: true,
      _count: { select: { listingLinks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const listingLinks = await prisma.channelListingLink.findMany({
    where: { connection: { memberId: userId } },
    select: {
      connectionId: true,
      storeItemId: true,
      provider: true,
      syncError: true,
      connection: { select: { status: true } },
    },
  });
  const photoHostCountByConnection = new Map<string, number>();
  for (const link of listingLinks) {
    if (link.provider !== "ebay" || !isEbayPhotoHostFamilySyncError(link.syncError)) continue;
    photoHostCountByConnection.set(
      link.connectionId,
      (photoHostCountByConnection.get(link.connectionId) ?? 0) + 1
    );
  }
  const overlapRows = listingLinks.map((l) => ({
    connectionId: l.connectionId,
    storeItemId: l.storeItemId,
    connectionStatus: l.connection.status,
  }));

  return NextResponse.json(
    connections.map((c) => {
      const readyToPublish = c.status === "active" && connectionReadyToPublish(c);
      const overlap = countLinkedOverlap(c.id, overlapRows);
      const health = connectionHealthUx({
        status: c.status,
        lastError: c.lastError,
        config: c.config,
      });
      return {
        id: c.id,
        provider: c.provider,
        shopId: c.externalShopId,
        shopName: c.externalShopName,
        status: c.status,
        lastError: c.lastError,
        hasShippingProfile: Boolean(c.etsyShippingProfileId),
        readyToPublish,
        publishBlockReason: publishBlockReason(c),
        lastReconciledAt: c.lastReconciledAt,
        linkedListings: c._count.listingLinks,
        linkedOnlyThisChannel: overlap.linkedOnlyThisChannel,
        linkedAlsoOnOthers: overlap.linkedAlsoOnOthers,
        connectedAt: c.createdAt,
        healthKind: health.kind,
        healthMessage: health.message || null,
        pauseReason: health.pauseReason,
        channelSalesNote: CHANNEL_SALES_FULFILL_NOTE,
        photoHostNotice:
          c.provider === "ebay" && photoHostCountByConnection.has(c.id)
            ? ebayPhotoHostFamilyShopSummary(photoHostCountByConnection.get(c.id) ?? 1)
            : null,
      };
    })
  );
}
