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

  const pendingDeletion = await prisma.groupDeletionRequest.findFirst({
    where: { groupId: ctx.group.id, status: "pending" },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json({
    slug: ctx.group.slug,
    name: ctx.group.name,
    isCreator: ctx.isCreator,
    pendingDeletionRequest: pendingDeletion,
  });
}
