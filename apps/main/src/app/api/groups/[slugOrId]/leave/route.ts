import { NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const session = await getServerSession(authOptions);
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
