import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";

/**
 * POST /api/members/[id]/unfriend
 * Unfriend a member by their member ID.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { id: targetId } = await params;
  const userId = session.user.id;

  if (userId === targetId) {
    return NextResponse.json({ error: "Cannot unfriend yourself" }, { status: 400 });
  }

  const friendship = await prisma.friendRequest.findFirst({
    where: {
      status: "accepted",
      OR: [
        { requesterId: userId, addresseeId: targetId },
        { requesterId: targetId, addresseeId: userId },
      ],
    },
  });

  if (!friendship) {
    return NextResponse.json({ error: "Not friends with this member" }, { status: 404 });
  }

  await prisma.friendRequest.delete({ where: { id: friendship.id } });

  return NextResponse.json({ ok: true });
}
