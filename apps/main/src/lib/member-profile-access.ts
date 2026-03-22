import { prisma } from "database";

/**
 * Whether a viewer may see another member's bio, badges, favorites, and post photos.
 * Matches GET /api/members/[id] visibility.
 */
export async function canViewerSeeFullMemberProfile(
  viewerId: string | null,
  memberId: string,
  privacyLevel: string
): Promise<boolean> {
  if (viewerId === memberId) return true;
  const isPrivate = privacyLevel === "friends_only" || privacyLevel === "completely_private";
  if (!isPrivate) return true;
  if (!viewerId) return false;
  const friendship = await prisma.friendRequest.findFirst({
    where: {
      status: "accepted",
      OR: [
        { requesterId: viewerId, addresseeId: memberId },
        { requesterId: memberId, addresseeId: viewerId },
      ],
    },
    select: { id: true },
  });
  return !!friendship;
}
