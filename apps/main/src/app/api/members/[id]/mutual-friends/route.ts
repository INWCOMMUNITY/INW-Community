import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

/**
 * GET /api/members/[id]/mutual-friends
 * Returns mutual friends between the current user and the target member.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: targetId } = await params;
  const viewerId = session.user.id;

  if (viewerId === targetId) {
    return NextResponse.json({ mutualFriends: [], count: 0 });
  }

  // Get viewer's friends
  const viewerFriendships = await prisma.friendRequest.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: viewerId }, { addresseeId: viewerId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const viewerFriendIds = new Set(
    viewerFriendships.map((f) =>
      f.requesterId === viewerId ? f.addresseeId : f.requesterId
    )
  );

  // Get target's friends
  const targetFriendships = await prisma.friendRequest.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: targetId }, { addresseeId: targetId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const targetFriendIds = new Set(
    targetFriendships.map((f) =>
      f.requesterId === targetId ? f.addresseeId : f.requesterId
    )
  );

  // Find intersection
  const mutualIds = [...viewerFriendIds].filter((id) => targetFriendIds.has(id));

  if (mutualIds.length === 0) {
    return NextResponse.json({ mutualFriends: [], count: 0 });
  }

  // Get member details for up to 5 mutual friends (for avatar display)
  const mutualFriends = await prisma.member.findMany({
    where: { id: { in: mutualIds.slice(0, 5) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
    },
  });

  return NextResponse.json({
    mutualFriends,
    count: mutualIds.length,
  });
}
