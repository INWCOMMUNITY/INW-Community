import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 50);
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
  const skip = page * limit;

  // Exclude self and blocked relationships. Omit status filter so legacy rows (null status) are included and browse list is never empty; optionally add status: "active" after backfilling DB.
  const baseWhere = {
    id: { not: session.user.id },
    blocksReceived: { none: { blockerId: session.user.id } }, // don't show members I blocked
    blocksGiven: { none: { blockedId: session.user.id } }, // don't show members who blocked me
  };

  const memberSelect = {
    id: true,
    firstName: true,
    lastName: true,
    profilePhotoUrl: true,
    city: true,
    allTimePointsEarned: true,
    memberBadges: {
      select: { badge: { select: { id: true, name: true, slug: true } } },
    },
    savedItems: {
      where: { type: "business" },
      take: 5,
      select: { referenceId: true },
    },
  } as const;

  if (q.length >= 2) {
    const rows = await prisma.member.findMany({
      where: {
        ...baseWhere,
        OR: [
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: memberSelect,
      take: limit,
      skip,
    });
    const businessIds = [...new Set(rows.flatMap((r) => r.savedItems.map((s) => s.referenceId)))];
    const businesses =
      businessIds.length > 0
        ? await prisma.business.findMany({
            where: { id: { in: businessIds } },
            select: { id: true, name: true, slug: true },
          })
        : [];
    const businessMap = new Map(businesses.map((b) => [b.id, b]));
    const members = rows.map((m) => ({
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      profilePhotoUrl: m.profilePhotoUrl,
      city: m.city,
      allTimePointsEarned: m.allTimePointsEarned ?? 0,
      badges: m.memberBadges.map((mb) => mb.badge),
      favoriteBusinesses: m.savedItems
        .map((s) => businessMap.get(s.referenceId))
        .filter(Boolean) as { id: string; name: string; slug: string }[],
    }));
    return NextResponse.json({ members });
  }

  // Browse: return first page of members when q is empty
  const rows = await prisma.member.findMany({
    where: baseWhere,
    select: memberSelect,
    take: limit,
    skip,
    orderBy: { createdAt: "desc" },
  });
  const businessIds = [...new Set(rows.flatMap((r) => r.savedItems.map((s) => s.referenceId)))];
  const businesses =
    businessIds.length > 0
      ? await prisma.business.findMany({
          where: { id: { in: businessIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
  const businessMap = new Map(businesses.map((b) => [b.id, b]));
  const members = rows.map((m) => ({
    id: m.id,
    firstName: m.firstName,
    lastName: m.lastName,
    profilePhotoUrl: m.profilePhotoUrl,
    city: m.city,
    allTimePointsEarned: m.allTimePointsEarned ?? 0,
    badges: m.memberBadges.map((mb) => mb.badge),
    favoriteBusinesses: m.savedItems
      .map((s) => businessMap.get(s.referenceId))
      .filter(Boolean) as { id: string; name: string; slug: string }[],
  }));
  return NextResponse.json({ members });
}
