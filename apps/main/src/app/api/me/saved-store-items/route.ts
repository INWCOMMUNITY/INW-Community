import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const saved = await prisma.savedItem.findMany({
    where: { memberId: session.user.id, type: "store_item" },
    orderBy: { createdAt: "desc" },
  });

  const itemIds = saved.map((s) => s.referenceId);
  const items =
    itemIds.length > 0
      ? await prisma.storeItem.findMany({
          where: { id: { in: itemIds }, status: "active" },
          select: {
            id: true,
            title: true,
            slug: true,
            photos: true,
            priceCents: true,
            category: true,
            listingType: true,
          },
        })
      : [];

  const itemMap = new Map(items.map((i) => [i.id, i]));
  const result = saved
    .map((s) => itemMap.get(s.referenceId))
    .filter((i): i is NonNullable<typeof i> => i != null);

  return NextResponse.json({ items: result });
}
