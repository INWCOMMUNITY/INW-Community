import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

const bodySchema = z.object({
  friendIds: z.array(z.string().min(1)).min(1).max(50),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, memberId: true },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  // Inviter must own the event (memberId) or be associated via business
  if (event.memberId !== session.user.id) {
    return NextResponse.json({ error: "You can only invite friends to events you created" }, { status: 403 });
  }

  let body: { friendIds: string[] };
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Verify each friendId is an accepted friend
  const friendships = await prisma.friendRequest.findMany({
    where: {
      status: "accepted",
      OR: [
        { requesterId: session.user.id, addresseeId: { in: body.friendIds } },
        { addresseeId: session.user.id, requesterId: { in: body.friendIds } },
      ],
    },
  });

  const validFriendIds = new Set(
    friendships.map((f) =>
      f.requesterId === session.user.id ? f.addresseeId : f.requesterId
    )
  );

  const toInvite = body.friendIds.filter((id) => validFriendIds.has(id) && id !== session.user.id);

  if (toInvite.length === 0) {
    return NextResponse.json({ error: "No valid friends to invite" }, { status: 400 });
  }

  const created = await prisma.eventInvite.createMany({
    data: toInvite.map((inviteeId) => ({
      eventId,
      inviterId: session.user.id,
      inviteeId,
      status: "pending",
    })),
    skipDuplicates: true,
  });

  if (created.count > 0) {
    const { awardPartyPlannerBadge } = await import("@/lib/badge-award");
    awardPartyPlannerBadge(session.user.id).catch(() => {});
  }

  return NextResponse.json({ ok: true, invited: created.count });
}
