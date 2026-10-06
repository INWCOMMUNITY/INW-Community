import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

/**
 * GET /api/wix/listings/eligible
 * INW store items that can be listed on Wix (not already linked on this connection).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await prisma.wixConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      status: true,
      shopName: true,
      siteId: true,
      catalogVersion: true,
    },
  });
  if (!connection) {
    return NextResponse.json({
      connectionStatus: "DISCONNECTED",
      listings: [],
    });
  }

  const mapped = await prisma.wixListingLink.findMany({
    where: { wixConnectionId: connection.id, memberId },
    select: {
      storeItemId: true,
      wixProductId: true,
      readiness: true,
      issueCode: true,
      issueMessage: true,
      remoteProductVisible: true,
    },
  });
  const linkedIds = new Set(mapped.map((m) => m.storeItemId));
  const linkedByStoreItemId = new Map(mapped.map((m) => [m.storeItemId, m] as const));

  const items = await prisma.storeItem.findMany({
    where: {
      memberId,
      status: { in: ["active", "sold_out"] },
      endedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      slug: true,
      sku: true,
      priceCents: true,
      quantity: true,
      status: true,
      inventoryTracking: true,
      photos: true,
      _count: { select: { storeVariants: { where: { status: "ACTIVE" } } } },
    },
  });

  const listings = items
    .filter((item) => !linkedIds.has(item.id))
    .map((item) => {
      const existing = linkedByStoreItemId.get(item.id) ?? null;
      const photoCount = Array.isArray(item.photos)
        ? item.photos.filter((p) => typeof p === "string" && p.trim().length > 0).length
        : 0;
      const photosReady = photoCount >= 1;
      let unsupportedReason: string | null = null;
      if (item._count.storeVariants < 1) {
        unsupportedReason = "Listing needs at least one active variant";
      } else if (!photosReady) {
        unsupportedReason = "Add at least one photo before listing on Wix";
      }
      return {
        storeItemId: item.id,
        title: item.title,
        slug: item.slug,
        sku: item.sku,
        priceCents: item.priceCents,
        quantity: item.quantity,
        status: item.status,
        variantCount: item._count.storeVariants,
        photoCount,
        photosReady,
        inventoryTracking: item.inventoryTracking,
        supported: item._count.storeVariants >= 1 && photosReady,
        unsupportedReason,
        linkedButNotLive: Boolean(existing),
        wixProductId: existing?.wixProductId ?? null,
        readiness: existing?.readiness ?? null,
        issueCode: existing?.issueCode ?? null,
        issueMessage: existing?.issueMessage ?? null,
        remoteProductVisible: existing?.remoteProductVisible ?? null,
      };
    });

  return NextResponse.json({
    connectionStatus: "ACTIVE",
    connection: {
      id: connection.id,
      siteId: connection.siteId,
      shopName: connection.shopName,
      catalogVersion: connection.catalogVersion,
    },
    listings,
  });
}
