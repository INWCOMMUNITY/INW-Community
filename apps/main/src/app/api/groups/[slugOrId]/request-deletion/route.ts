import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { getGroupAdminContext } from "@/lib/group-admin-context";

export async function POST(
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

  if (!ctx.isCreator) {
    return NextResponse.json(
      { error: "Only the group creator can request deletion" },
      { status: 403 }
    );
  }

  const existing = await prisma.groupDeletionRequest.findFirst({
    where: { groupId: ctx.group.id, status: "pending" },
  });
  if (existing) {
    return NextResponse.json({ error: "A deletion request is already pending review" }, { status: 400 });
  }

  const row = await prisma.groupDeletionRequest.create({
    data: {
      groupId: ctx.group.id,
      requesterMemberId: session.user.id,
      status: "pending",
    },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
