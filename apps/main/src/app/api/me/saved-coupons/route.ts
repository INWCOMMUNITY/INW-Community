import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const saved = await prisma.savedItem.findMany({
    where: { memberId: session.user.id, type: "coupon" },
    orderBy: { createdAt: "desc" },
  });

  const couponIds = saved.map((s) => s.referenceId).filter(Boolean);
  const coupons =
    couponIds.length > 0
      ? await prisma.coupon.findMany({
          where: { id: { in: couponIds } },
          include: { business: { select: { name: true, slug: true } } },
        })
      : [];

  const couponMap = new Map(coupons.map((c) => [c.id, c]));
  const result = saved
    .map((s) => couponMap.get(s.referenceId))
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      discount: c.discount,
      imageUrl: c.imageUrl,
      business: c.business,
    }));

  return NextResponse.json({ coupons: result });
}
