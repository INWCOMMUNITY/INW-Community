import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { z } from "zod";

const bodySchema = z.object({
  status: z.enum(["accepted", "declined"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { id } = await params;
  const friendReq = await prisma.friendRequest.findUnique({
    where: { id },
  });
  if (!friendReq) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (friendReq.addresseeId !== session.user.id) {
    return NextResponse.json({ error: "Can only accept/decline requests sent to you" }, { status: 403 });
  }
  if (friendReq.status !== "pending") {
    return NextResponse.json({ error: "Request already processed" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { status } = bodySchema.parse(body);
    await prisma.friendRequest.update({
      where: { id },
      data: { status },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * DELETE /api/friend-requests/[id]
 * - Cancel a pending outgoing request (requester only)
 * - Unfriend an accepted friendship (either party)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await getSessionForApi(req)) ?? (await getServerSession(authOptions));
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const { id } = await params;
  const friendReq = await prisma.friendRequest.findUnique({
    where: { id },
  });
  if (!friendReq) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = session.user.id;
  const isRequester = friendReq.requesterId === userId;
  const isAddressee = friendReq.addresseeId === userId;

  if (!isRequester && !isAddressee) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (friendReq.status === "pending") {
    // Only the requester can cancel a pending request
    if (!isRequester) {
      return NextResponse.json(
        { error: "Only the sender can cancel a pending request" },
        { status: 403 }
      );
    }
    await prisma.friendRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true, action: "cancelled" });
  }

  if (friendReq.status === "accepted") {
    // Either party can unfriend
    await prisma.friendRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true, action: "unfriended" });
  }

  // For declined requests, only allow requester to delete
  if (friendReq.status === "declined" && isRequester) {
    await prisma.friendRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  return NextResponse.json({ error: "Cannot delete this request" }, { status: 400 });
}
