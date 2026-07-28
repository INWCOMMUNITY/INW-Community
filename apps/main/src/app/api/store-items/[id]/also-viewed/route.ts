import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: storeItemId } = await params;
  
  if (!storeItemId) {
    return NextResponse.json({ error: "Store item ID required" }, { status: 400 });
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const viewersOfThis = await prisma.memberListingView.findMany({
      where: {
        storeItemId,
        viewerId: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { viewerId: true },
      distinct: ["viewerId"],
      take: 100,
    });

    const viewerIds = viewersOfThis
      .map((v) => v.viewerId)
      .filter((id): id is string => id !== null);

    if (viewerIds.length === 0) {
      return NextResponse.json([]);
    }

    const otherViewedItems = await prisma.memberListingView.groupBy({
      by: ["storeItemId"],
      where: {
        viewerId: { in: viewerIds },
        storeItemId: { not: storeItemId },
        createdAt: { gte: thirtyDaysAgo },
      },
      _count: { viewerId: true },
      orderBy: { _count: { viewerId: "desc" } },
      take: 20,
    });

    if (otherViewedItems.length === 0) {
      return NextResponse.json([]);
    }

    const itemIds = otherViewedItems.map((o) => o.storeItemId);
    
    const items = await prisma.storeItem.findMany({
      where: {
        id: { in: itemIds },
        status: "active",
        quantity: { gt: 0 },
        member: { stripeConnectAccountId: { not: null } },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        photos: true,
        category: true,
        secondaryCategory: true,
        priceCents: true,
        quantity: true,
        business: { select: { id: true, name: true, slug: true, logoUrl: true } },
      },
    });

    const itemMap = new Map(items.map((i) => [i.id, i]));
    const sortedItems = itemIds
      .map((id) => itemMap.get(id))
      .filter((item): item is NonNullable<typeof item> => item !== undefined)
      .slice(0, 10);

    return NextResponse.json(sortedItems);
  } catch (e) {
    console.error("[also-viewed] Error:", e);
    return NextResponse.json([]);
  }
}
