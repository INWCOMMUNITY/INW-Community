import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { z } from "zod";
import { validateText } from "@/lib/content-moderation";

const bodySchema = z.object({
  friendIds: z.array(z.string().min(1)).min(1).max(50),
  message: z.string().max(500).optional(),
});

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

  const { id: eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, status: true },
  });

  if (!event || event.status !== "approved") {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const messageTrimmed = body.message?.trim() ?? "";
  if (messageTrimmed.length > 0) {
    const messageCheck = validateText(messageTrimmed, "message");
    if (!messageCheck.allowed) {
      return NextResponse.json(
        { error: messageCheck.reason ?? "Message not allowed." },
        { status: 400 }
      );
    }
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

  if (newInviteeIds.length === 0) {
    return NextResponse.json({ ok: true, invited: 0, earnedBadges: [] });
  }

  const created = await prisma.eventInvite.createMany({
    data: newInviteeIds.map((inviteeId) => ({
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
        title: "Hey! You’ve been invited to a local event!",
        body: `${inviterName} wants you at “${title}” — tap to check it out!`,
        data: {
          screen: "event_invite",
          inviteId: String(row.id),
          eventSlug: String(slug),
          eventTitle: String(title),
        },
        category: "events",
      }).catch(() => {});
    }

    const { sendEventInviteChatMessages } = await import("@/lib/send-event-invite-chat");
    await sendEventInviteChatMessages({
      inviterId: session.user.id,
      inviteeIds: newInviteeIds,
      eventId,
      eventSlug: String(slug),
      eventTitle: String(title),
      customMessage: messageTrimmed.length > 0 ? messageTrimmed : undefined,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, invited: created.count, earnedBadges });
}
