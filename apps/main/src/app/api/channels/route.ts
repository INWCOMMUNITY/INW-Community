import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { connectionReadyToPublish, publishBlockReason } from "@/lib/channels/connection-publish";

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

  return NextResponse.json(
    connections.map((c) => {
      const readyToPublish = c.status === "active" && connectionReadyToPublish(c);
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
        connectedAt: c.createdAt,
      };
    })
  );
}
