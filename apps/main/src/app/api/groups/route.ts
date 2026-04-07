import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireAdmin } from "@/lib/admin-auth";
import { createGroupForMember, groupCreationPayloadSchema } from "@/lib/create-group-core";
import { z } from "zod";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const category = searchParams.get("category") ?? undefined;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 100);

  const where: { name?: { contains: string; mode: "insensitive" }; category?: string } = {};
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (category) where.category = category;

  const groups = await prisma.group.findMany({
    where: Object.keys(where).length ? where : undefined,
    include: {
      createdBy: {
        select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true },
      },
      _count: { select: { members: true, groupPosts: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const groupIds = groups.map((g) => g.id);
  const feedPostCounts =
    groupIds.length > 0
      ? await prisma.post.groupBy({
          by: ["groupId"],
          where: { groupId: { in: groupIds } },
          _count: { _all: true },
        })
      : [];
  const feedPostCountByGroupId = Object.fromEntries(
    feedPostCounts.map((row) => [row.groupId, row._count._all])
  );

  let membershipMap: Record<string, { role: string }> = {};
  if (session?.user?.id && groups.length > 0) {
    const memberships = await prisma.groupMember.findMany({
      where: {
        groupId: { in: groupIds },
        memberId: session.user.id,
      },
      select: { groupId: true, role: true },
    });
    membershipMap = Object.fromEntries(memberships.map((m) => [m.groupId, { role: m.role }]));
  }

  const groupsWithMembership = groups.map((g) => {
    const membership = membershipMap[g.id];
    return {
      ...g,
      _count: {
        members: g._count.members,
        /** Unified feed posts (`Post.groupId`), not legacy `GroupPost` rows */
        groupPosts: feedPostCountByGroupId[g.id] ?? 0,
      },
      isMember: !!membership,
      memberRole: membership?.role ?? null,
    };
  });

  return NextResponse.json({ groups: groupsWithMembership });
}

/**
 * Direct group creation is restricted to platform admins. Members submit
 * `/api/group-creation-requests` for review.
 */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json(
      { error: "Group creation requires admin approval. Submit a request from the app or website." },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const adminCreateSchema = groupCreationPayloadSchema.extend({
      createdByMemberId: z.string().min(1),
    });
    const parsed = adminCreateSchema.parse(body);
    const { createdByMemberId, ...data } = parsed;

    const { group, earnedBadges } = await createGroupForMember(createdByMemberId, data);
    const full = await prisma.group.findUnique({
      where: { id: group.id },
    });
    return NextResponse.json({ group: full, earnedBadges });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
