import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

/**
 * GET /api/businesses/[id]/badges
 * Returns badges for a business (public).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: businessId } = await params;
  if (!businessId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const businessBadges = await prisma.businessBadge.findMany({
      where: { businessId, displayOnPage: true },
      include: { badge: true },
      orderBy: { earnedAt: "desc" },
    });
    return NextResponse.json(businessBadges);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
