import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slugOrId } = await params;

  const group = await prisma.group.findFirst({
    where: isCuid(slugOrId) ? { id: slugOrId } : { slug: slugOrId },
  });

  if (!group) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  if (group.createdById === session.user.id) {
    return NextResponse.json({ error: "Group creator cannot leave; transfer ownership or delete the group" }, { status: 400 });
  }

  await prisma.groupMember.deleteMany({
    where: {
      groupId: group.id,
      memberId: session.user.id,
    },
  });

  return NextResponse.json({ ok: true });
}
