import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { verifiedMemberWhere } from "@/lib/member-public-visibility";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { buildFriendSuggestionReasons } from "@/lib/friend-suggestion-reasons";

export async function GET(req: NextRequest) {
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const myId = session.user.id;

  // Get my profile info
  const myProfile = await prisma.member.findUnique({
    where: { id: myId },
    select: { city: true },
  });
  const myCity = myProfile?.city?.toLowerCase().trim() || null;

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

  // My group IDs
  const myGroups = await prisma.groupMember.findMany({
    where: { memberId: myId },
    select: { groupId: true },
  });
  const myGroupIds = new Set(myGroups.map((g) => g.groupId));

  // My followed business IDs
  const myFollowedBusinesses = await prisma.savedItem.findMany({
    where: { memberId: myId, type: "business" },
    select: { referenceId: true },
  });
  const myFollowedBusinessIds = new Set(myFollowedBusinesses.map((s) => s.referenceId));

  // Score map: candidate -> total relevance score
  const scoreMap: Record<string, number> = {};
  const mutualCountMap: Record<string, number> = {};
  const sharedGroupsMap: Record<string, string[]> = {};
  const sharedBusinessCountMap: Record<string, number> = {};

  // 1. Friends of friends (mutual friends scoring)
  if (myFriendIds.size > 0) {
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

    for (const row of friendsOfFriends) {
      const requesterIsMyFriend = myFriendIds.has(row.requesterId);
      const addresseeIsMyFriend = myFriendIds.has(row.addresseeId);
      let candidate: string | null = null;
      if (requesterIsMyFriend && row.addresseeId !== myId) candidate = row.addresseeId;
      else if (addresseeIsMyFriend && row.requesterId !== myId) candidate = row.requesterId;
      if (!candidate || myFriendIds.has(candidate) || pendingIds.has(candidate)) continue;
      mutualCountMap[candidate] = (mutualCountMap[candidate] ?? 0) + 1;
      scoreMap[candidate] = (scoreMap[candidate] ?? 0) + 3; // 3 points per mutual friend
    }
  }

  // 2. Shared group membership scoring
  if (myGroupIds.size > 0) {
    const myGroupIdList = Array.from(myGroupIds);
    const [groupMembers, groups] = await Promise.all([
      prisma.groupMember.findMany({
        where: {
          groupId: { in: myGroupIdList },
          memberId: { not: myId },
        },
        select: { memberId: true, groupId: true },
      }),
      prisma.group.findMany({
        where: { id: { in: myGroupIdList } },
        select: { id: true, name: true },
      }),
    ]);
    const groupNameById = new Map(groups.map((g) => [g.id, g.name]));

    for (const gm of groupMembers) {
      if (myFriendIds.has(gm.memberId) || pendingIds.has(gm.memberId)) continue;
      scoreMap[gm.memberId] = (scoreMap[gm.memberId] ?? 0) + 2; // 2 points per shared group
      const groupName = groupNameById.get(gm.groupId);
      if (!groupName) continue;
      const names = sharedGroupsMap[gm.memberId] ?? (sharedGroupsMap[gm.memberId] = []);
      if (!names.includes(groupName)) names.push(groupName);
    }
  }

  // 3. Followed businesses in common scoring
  if (myFollowedBusinessIds.size > 0) {
    const sharedBusinessFollowers = await prisma.savedItem.findMany({
      where: {
        type: "business",
        referenceId: { in: Array.from(myFollowedBusinessIds) },
        memberId: { not: myId },
      },
      select: { memberId: true },
    });

    for (const sf of sharedBusinessFollowers) {
      if (myFriendIds.has(sf.memberId) || pendingIds.has(sf.memberId)) continue;
      scoreMap[sf.memberId] = (scoreMap[sf.memberId] ?? 0) + 1; // 1 point per shared followed business
      sharedBusinessCountMap[sf.memberId] = (sharedBusinessCountMap[sf.memberId] ?? 0) + 1;
    }
  }

  const candidateIds = Object.keys(scoreMap).filter((id) => scoreMap[id] > 0);
  if (candidateIds.length === 0) {
    return NextResponse.json({ suggested: [] });
  }

  const members = await prisma.member.findMany({
    where: {
      ...verifiedMemberWhere,
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
      bio: true,
    },
  });

  // 4. Location proximity scoring (same city)
  const suggested = members
    .map((m) => {
      let score = scoreMap[m.id] ?? 0;
      const memberCity = m.city?.toLowerCase().trim() || null;
      const sameCity = !!(myCity && memberCity && myCity === memberCity);
      if (sameCity) {
        score += 2; // 2 points for same city
      }
      const mutualCount = mutualCountMap[m.id] ?? 0;
      return {
        ...m,
        mutualCount,
        reasons: buildFriendSuggestionReasons({
          mutualCount,
          sameCity,
          sharedGroupNames: sharedGroupsMap[m.id] ?? [],
          sharedBusinessCount: sharedBusinessCountMap[m.id] ?? 0,
        }),
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  return NextResponse.json({ suggested });
}
