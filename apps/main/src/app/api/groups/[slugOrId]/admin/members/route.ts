import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { getGroupAdminContext } from "@/lib/group-admin-context";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { slugOrId } = await params;
  const ctx = await getGroupAdminContext(slugOrId, session.user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const take = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 100);
  const skip = (page - 1) * take;

  const members = await prisma.groupMember.findMany({
    where: { groupId: ctx.group.id },
    take,
    skip,
    orderBy: { joinedAt: "desc" },
    include: {
      member: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profilePhotoUrl: true,
        },
      },
    },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      memberId: m.memberId,
      role: m.role,
      joinedAt: m.joinedAt,
      member: m.member,
      isCreator: m.memberId === ctx.group.createdById,
    })),
    page,
    hasMore: members.length === take,
  });
}
