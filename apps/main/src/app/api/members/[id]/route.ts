import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/members/[id] – profile for a member (used by native app and any client).
 * Name and profile photo are always public. When profile is private (friends_only), only friends (or self) see bio, badges, favorite businesses.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  const viewerId = session?.user?.id ?? null;

  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      bio: true,
      city: true,
      allTimePointsEarned: true,
      privacyLevel: true,
      memberBadges: {
        select: { badge: { select: { id: true, name: true, slug: true, description: true } } },
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

  const isSelf = viewerId === id;
  const isPrivate =
    member.privacyLevel === "friends_only" || member.privacyLevel === "completely_private";
  let canSeeFullProfile = isSelf;
  if (!canSeeFullProfile && isPrivate && viewerId) {
    const friendship = await prisma.friendRequest.findFirst({
      where: {
        status: "accepted",
        OR: [
          { requesterId: viewerId, addresseeId: id },
          { requesterId: id, addresseeId: viewerId },
        ],
      },
    });
    canSeeFullProfile = !!friendship;
  }

  if (!canSeeFullProfile && isPrivate) {
    return NextResponse.json({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      profilePhotoUrl: member.profilePhotoUrl,
      city: member.city,
      allTimePointsEarned: member.allTimePointsEarned ?? 0,
      badges: [],
      favoriteBusinesses: [],
      canSeeFullProfile: false,
    });
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
    badges: member.memberBadges.map((mb) => ({
      id: mb.badge.id,
      name: mb.badge.name,
      slug: mb.badge.slug,
      description: mb.badge.description,
    })),
    favoriteBusinesses,
    canSeeFullProfile: true,
  });
}
