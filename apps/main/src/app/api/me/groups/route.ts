import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = new URL(req.url).searchParams.get("scope") ?? "admin"; // admin | member

  const memberships = await prisma.groupMember.findMany({
    where: {
      memberId: session.user.id,
      ...(scope === "member" ? {} : { role: "admin" }),
    },
    include: {
      group: {
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { members: true, groupPosts: true } },
        },
      },
    },
  });

  const memberGroupIds = memberships.map((m) => m.group.id);
  const feedPostCounts =
    memberGroupIds.length > 0
      ? await prisma.post.groupBy({
          by: ["groupId"],
          where: { groupId: { in: memberGroupIds } },
          _count: { _all: true },
        })
      : [];
  const feedPostCountByGroupId = Object.fromEntries(
    feedPostCounts.map((row) => [row.groupId, row._count._all])
  );

  const groups = memberships.map((m) => ({
    ...m.group,
    _count: {
      members: m.group._count.members,
      groupPosts: feedPostCountByGroupId[m.group.id] ?? 0,
    },
    isCreator: m.group.createdById === session.user.id,
  }));

  return NextResponse.json({ groups });
}
