import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const saved = await prisma.savedItem.findMany({
    where: { memberId: session.user.id, type: "business" },
    orderBy: { createdAt: "desc" },
  });

  const businessIds = saved.map((s) => s.referenceId);
  const businesses =
    businessIds.length > 0
      ? await prisma.business.findMany({
          where: { id: { in: businessIds } },
          select: { id: true, name: true, slug: true, logoUrl: true, city: true },
        })
      : [];

  const businessMap = new Map(businesses.map((b) => [b.id, b]));
  const result = saved
    .map((s) => businessMap.get(s.referenceId))
    .filter((b): b is NonNullable<typeof b> => b != null);

  return NextResponse.json({ businesses: result });
}
