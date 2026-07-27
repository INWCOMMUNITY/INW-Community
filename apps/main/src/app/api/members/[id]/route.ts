import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canViewerSeeFullMemberProfile } from "@/lib/member-profile-access";
import { hasBlockBetween } from "@/lib/member-block";
import { memberIsSiteVisible } from "@/lib/member-public-visibility";

/**
 * GET /api/members/[id] – profile for a member (used by native app and any client).
 * Members who are not “site-visible” (residents without verified email; business/seller without paid/granted access) return 404. Otherwise name and profile photo are always public;
 * when profile is private (friends_only), only friends (or self) see bio, badges, favorite businesses.
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
      emailVerifiedAt: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      coverPhotoUrl: true,
      bio: true,
      city: true,
      allTimePointsEarned: true,
      privacyLevel: true,
      createdAt: true,
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

  if (!(await memberIsSiteVisible(id))) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (viewerId && (await hasBlockBetween(viewerId, id))) {
    return NextResponse.json({ error: "Not available", blocked: true }, { status: 404 });
  }

  const isPrivate =
    member.privacyLevel === "friends_only" || member.privacyLevel === "completely_private";
  const canSeeFullProfile = await canViewerSeeFullMemberProfile(viewerId, id, member.privacyLevel);

  if (!canSeeFullProfile && isPrivate) {
    return NextResponse.json({
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      profilePhotoUrl: member.profilePhotoUrl,
      coverPhotoUrl: member.coverPhotoUrl,
      city: member.city,
      allTimePointsEarned: member.allTimePointsEarned ?? 0,
      badges: [],
      favoriteBusinesses: [],
      canSeeFullProfile: false,
    });
  }

  const [businessIds, postCount, friendCount] = await Promise.all([
    Promise.resolve(member.savedItems.map((s) => s.referenceId)),
    prisma.post.count({ where: { authorId: id } }),
    prisma.friendRequest.count({
      where: {
        status: "accepted",
        OR: [{ requesterId: id }, { addresseeId: id }],
      },
    }),
  ]);

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
    coverPhotoUrl: member.coverPhotoUrl,
    bio: member.bio,
    city: member.city,
    allTimePointsEarned: member.allTimePointsEarned ?? 0,
    memberSince: member.createdAt,
    postCount,
    friendCount,
    badgeCount: member.memberBadges.length,
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
