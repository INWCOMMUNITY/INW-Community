import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { getGroupAdminContext } from "@/lib/group-admin-context";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string; memberId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { slugOrId, memberId: targetMemberId } = await params;
  const ctx = await getGroupAdminContext(slugOrId, session.user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  if (targetMemberId === ctx.group.createdById) {
    return NextResponse.json({ error: "Cannot remove the group creator" }, { status: 400 });
  }

  const membership = await prisma.groupMember.findUnique({
    where: {
      groupId_memberId: { groupId: ctx.group.id, memberId: targetMemberId },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "Member not in group" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.groupMember.delete({
      where: { id: membership.id },
    }),
    prisma.groupMemberBan.upsert({
      where: {
        groupId_memberId: { groupId: ctx.group.id, memberId: targetMemberId },
      },
      create: {
        groupId: ctx.group.id,
        memberId: targetMemberId,
        bannedByMemberId: session.user.id,
      },
      update: {
        bannedByMemberId: session.user.id,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
