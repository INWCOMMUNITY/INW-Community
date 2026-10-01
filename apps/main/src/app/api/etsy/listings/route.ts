import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      shopId: true,
      shopName: true,
      listingContentLastPolledAt: true,
    },
  });
  if (!connection) {
    return NextResponse.json({ connection: null, listings: [] });
  }

  const links = await prisma.etsyListingLink.findMany({
    where: { etsyConnectionId: connection.id, memberId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      storeItemId: true,
      etsyListingId: true,
      readiness: true,
      contentHealth: true,
      inventoryHealth: true,
      issueCode: true,
      issueMessage: true,
      importSource: true,
      updatedAt: true,
      storeItem: { select: { title: true, status: true } },
    },
  });

  return NextResponse.json({
    connection: {
      id: connection.id,
      shopId: connection.shopId,
      shopName: connection.shopName,
      listingContentLastPolledAt: connection.listingContentLastPolledAt,
      mappedListingCount: links.length,
    },
    listings: links.map((row) => ({
      id: row.id,
      storeItemId: row.storeItemId,
      etsyListingId: row.etsyListingId,
      title: row.storeItem.title,
      storeItemStatus: row.storeItem.status,
      readiness: row.readiness,
      contentHealth: row.contentHealth,
      inventoryHealth: row.inventoryHealth,
      issueCode: row.issueCode,
      issueMessage: row.issueMessage,
      importSource: row.importSource,
      updatedAt: row.updatedAt,
    })),
  });
}
