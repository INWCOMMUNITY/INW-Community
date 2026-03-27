import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  friendIds: z.array(z.string().min(1)).min(1).max(50),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, memberId: true, businessId: true, business: { select: { memberId: true } } },
  });

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const isOwner =
    event.memberId === session.user.id ||
    (event.businessId != null && event.business?.memberId === session.user.id);
  if (!isOwner) {
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

  const alreadyInvited = await prisma.eventInvite.findMany({
    where: { eventId, inviteeId: { in: toInvite } },
    select: { inviteeId: true },
  });
  const alreadySet = new Set(alreadyInvited.map((r) => r.inviteeId));
  const newInviteeIds = toInvite.filter((id) => !alreadySet.has(id));

  const created = await prisma.eventInvite.createMany({
    data: toInvite.map((inviteeId) => ({
      eventId,
      inviterId: session.user.id,
      inviteeId,
      status: "pending",
    })),
    skipDuplicates: true,
  });

  let earnedBadges: { slug: string; name: string; description: string }[] = [];
  if (created.count > 0) {
    const { awardPartyPlannerBadge } = await import("@/lib/badge-award");
    try {
      earnedBadges = await awardPartyPlannerBadge(session.user.id);
    } catch {
      /* best-effort */
    }
  }

  if (newInviteeIds.length > 0) {
    const [eventMeta, inviter, inviteRows] = await Promise.all([
      prisma.event.findUnique({
        where: { id: eventId },
        select: { title: true, slug: true },
      }),
      prisma.member.findUnique({
        where: { id: session.user.id },
        select: { firstName: true, lastName: true },
      }),
      prisma.eventInvite.findMany({
        where: { eventId, inviteeId: { in: newInviteeIds } },
        select: { id: true, inviteeId: true },
      }),
    ]);
    const inviterName = inviter
      ? [inviter.firstName, inviter.lastName].filter(Boolean).join(" ").trim() || "Someone"
      : "Someone";
    const title = eventMeta?.title ?? "an event";
    const slug = eventMeta?.slug ?? "";
    const { sendPushNotification } = await import("@/lib/send-push-notification");
    for (const row of inviteRows) {
      sendPushNotification(row.inviteeId, {
        title: "Event invitation",
        body: `${inviterName} invited you to ${title}`,
        data: {
          screen: "event_invite",
          inviteId: String(row.id),
          eventSlug: String(slug),
          eventTitle: String(title),
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, invited: created.count, earnedBadges });
}
