import { NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const myId = session.user.id;

  // My accepted friend IDs
  const myFriendRows = await prisma.friendRequest.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: myId }, { addresseeId: myId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const myFriendIds = new Set<string>(
    myFriendRows.flatMap((r) => (r.requesterId === myId ? r.addresseeId : r.requesterId))
  );

  // Pending (so we don't suggest people I already requested or who requested me)
  const pendingRows = await prisma.friendRequest.findMany({
    where: {
      status: "pending",
      OR: [{ requesterId: myId }, { addresseeId: myId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const pendingIds = new Set<string>(
    pendingRows.flatMap((r) => (r.requesterId === myId ? r.addresseeId : r.requesterId))
  );

  if (myFriendIds.size === 0) {
    return NextResponse.json({ suggested: [] });
  }

  // Friends of my friends: for each friend, get their accepted friend IDs
  const friendIdsArray = Array.from(myFriendIds);
  const friendsOfFriends = await prisma.friendRequest.findMany({
    where: {
      status: "accepted",
      OR: [
        { requesterId: { in: friendIdsArray } },
        { addresseeId: { in: friendIdsArray } },
      ],
    },
    select: { requesterId: true, addresseeId: true },
  });

  // Count mutual: candidate (friend of my friend) -> number of my friends who are also their friends
  const mutualCount: Record<string, number> = {};
  for (const row of friendsOfFriends) {
    const requesterIsMyFriend = myFriendIds.has(row.requesterId);
    const addresseeIsMyFriend = myFriendIds.has(row.addresseeId);
    let candidate: string | null = null;
    if (requesterIsMyFriend && row.addresseeId !== myId) candidate = row.addresseeId;
    else if (addresseeIsMyFriend && row.requesterId !== myId) candidate = row.requesterId;
    if (!candidate || myFriendIds.has(candidate) || pendingIds.has(candidate)) continue;
    mutualCount[candidate] = (mutualCount[candidate] ?? 0) + 1;
  }

  const candidateIds = Object.keys(mutualCount).filter((id) => mutualCount[id] > 0);
  if (candidateIds.length === 0) {
    return NextResponse.json({ suggested: [] });
  }

  const members = await prisma.member.findMany({
    where: {
      id: { in: candidateIds },
      status: "active",
      privacyLevel: { not: "completely_private" },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePhotoUrl: true,
      city: true,
    },
  });

  const suggested = members
    .map((m) => ({ ...m, mutualCount: mutualCount[m.id] ?? 0 }))
    .sort((a, b) => b.mutualCount - a.mutualCount)
    .slice(0, 25);

  return NextResponse.json({ suggested });
}
