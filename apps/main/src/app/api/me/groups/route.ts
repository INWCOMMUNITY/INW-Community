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

  const groups = memberships.map((m) => ({
    ...m.group,
    isCreator: m.group.createdById === session.user.id,
  }));

  return NextResponse.json({ groups });
}
