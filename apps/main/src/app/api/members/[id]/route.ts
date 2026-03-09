import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";

/**
 * GET /api/members/[id] – public profile for a member (used by native app and any client).
 * Returns badges, all-time points, and favorite businesses.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const member = await prisma.member.findUnique({
    where: { id, status: "active" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      bio: true,
      city: true,
      allTimePointsEarned: true,
      memberBadges: {
        select: { badge: { select: { id: true, name: true, slug: true } } },
      },
      savedItems: {
        where: { type: "business" },
        take: 20,
        select: { referenceId: true },
      },
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const businessIds = member.savedItems.map((s) => s.referenceId);
  const favoriteBusinesses =
    businessIds.length > 0
      ? await prisma.business.findMany({
          where: { id: { in: businessIds } },
          select: { id: true, name: true, slug: true, logoUrl: true },
        })
      : [];

  return NextResponse.json({
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    profilePhotoUrl: member.profilePhotoUrl,
    bio: member.bio,
    city: member.city,
    allTimePointsEarned: member.allTimePointsEarned ?? 0,
    badges: member.memberBadges.map((mb) => mb.badge),
    favoriteBusinesses,
  });
}
