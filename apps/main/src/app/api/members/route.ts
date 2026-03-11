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

  // Exclude self and blocked relationships. If member_block table is missing (P2021), fall back to exclude self only.
  const baseWhereWithBlocks = {
    id: { not: session.user.id },
    blocksReceived: { none: { blockerId: session.user.id } },
    blocksGiven: { none: { blockedId: session.user.id } },
  };
  const baseWhereNoBlocks = { id: { not: session.user.id } };

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

  async function mapRowsToMembers(
    rows: Awaited<ReturnType<typeof prisma.member.findMany>>
  ) {
    const businessIds = [...new Set(rows.flatMap((r) => r.savedItems.map((s) => s.referenceId)))];
    const businessMap = new Map(
      businessIds.length > 0
        ? (
            await prisma.business.findMany({
              where: { id: { in: businessIds } },
              select: { id: true, name: true, slug: true },
            })
          ).map((b) => [b.id, b] as const)
        : []
    );
    return rows.map((m) => ({
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
  }

  const searchOr = q.length >= 2
    ? [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] as const
    : null;

  let rows: Awaited<ReturnType<typeof prisma.member.findMany>>;
  try {
    rows = await prisma.member.findMany({
      where: searchOr
        ? { ...baseWhereWithBlocks, OR: searchOr }
        : baseWhereWithBlocks,
      select: memberSelect,
      take: limit,
      skip,
      ...(searchOr ? {} : { orderBy: { createdAt: "desc" } }),
    });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2021") {
      rows = await prisma.member.findMany({
        where: searchOr ? { ...baseWhereNoBlocks, OR: searchOr } : baseWhereNoBlocks,
        select: memberSelect,
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
      });
    } else {
      throw e;
    }
  }

  const members = await mapRowsToMembers(rows);
  return NextResponse.json({ members });
}
