import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

/**
 * GET /api/me/badges
 * Returns current user's earned badges with display toggle.
 */
export async function GET(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ??
    (await getServerSession(authOptions));
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const memberBadges = await prisma.memberBadge.findMany({
      where: { memberId: userId },
      include: { badge: true },
      orderBy: { earnedAt: "desc" },
    });
    const businesses = await prisma.business.findMany({
      where: { memberId: userId },
      select: { id: true },
    });
    const businessIds = businesses.map((b) => b.id);
    const businessBadges = await prisma.businessBadge.findMany({
      where: { businessId: { in: businessIds } },
      include: { badge: true },
      orderBy: { earnedAt: "desc" },
    });
    return NextResponse.json({
      memberBadges,
      businessBadges,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const patchSchema = z.object({
  badgeId: z.string().min(1),
  displayOnProfile: z.boolean().optional(),
});

/**
 * PATCH /api/me/badges
 * Update display toggle for a member badge.
 */
export async function PATCH(req: NextRequest) {
  const session =
    (await getSessionForApi(req)) ??
    (await getServerSession(authOptions));
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const data = patchSchema.parse(body);
    const existing = await prisma.memberBadge.findUnique({
      where: {
        memberId_badgeId: { memberId: userId, badgeId: data.badgeId },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Badge not found" }, { status: 404 });
    }
    if (data.displayOnProfile !== undefined) {
      await prisma.memberBadge.update({
        where: { id: existing.id },
        data: { displayOnProfile: data.displayOnProfile },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: e.errors[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
