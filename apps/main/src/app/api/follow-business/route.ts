import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/follow-business?mine=1 - List businesses (seller storefronts) the user follows
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = req.nextUrl?.searchParams ?? new URLSearchParams();
  if (searchParams.get("mine") !== "1") {
    return NextResponse.json({ error: "Use ?mine=1" }, { status: 400 });
  }

  const follows = await prisma.followBusiness.findMany({
    where: { memberId: session.user.id },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          coverPhotoUrl: true,
          shortDescription: true,
          city: true,
          memberId: true,
          _count: { select: { storeItems: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const sellerMemberIds = await prisma.subscription.findMany({
    where: { plan: "seller", status: "active" },
    select: { memberId: true },
  });
  const sellerSet = new Set(sellerMemberIds.map((s) => s.memberId));

  const businesses = follows
    .map((f) => f.business)
    .filter((b): b is NonNullable<typeof b> => !!b && sellerSet.has(b.memberId))
    .map(({ _count, memberId, ...b }) => ({
      ...b,
      itemCount: _count?.storeItems ?? 0,
    }));

  return NextResponse.json(businesses);
}
