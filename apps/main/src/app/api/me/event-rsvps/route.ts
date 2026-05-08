import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { formatTime12h } from "@/lib/format-time";
import { CALENDAR_TYPES } from "types";
import { eventInviteEventHasPassed } from "@/lib/event-invite-visible";

/**
 * Events the member has RSVP’d to (any non-pending EventInvite as invitee).
 * `POST /api/events/[id]/rsvp` updates an existing friend-invite row in place (inviter stays the friend),
 * so we must not require `inviterId === inviteeId` or those RSVPs would look “unsaved” on My Events.
 * Pending invites from others stay on Invites only (`GET /api/me/event-invites`).
 */
export async function GET(_req: NextRequest) {
  const session = await getSessionForApi(_req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.eventInvite.findMany({
    where: {
      inviteeId: session.user.id,
      status: { in: ["accepted", "declined", "maybe"] },
    },
    include: {
      event: {
        include: { business: { select: { name: true, slug: true } } },
      },
    },
    orderBy: { event: { date: "asc" } },
  });

  const visible = rows.filter(
    (row) =>
      row.event.status === "approved" && !eventInviteEventHasPassed(row.event)
  );

  const events = visible.map((row) => {
    const event = row.event;
    const dateStr = new Date(event.date).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timeStr = event.time
      ? event.endTime
        ? `${formatTime12h(event.time)} – ${formatTime12h(event.endTime)}`
        : formatTime12h(event.time)
      : null;
    const calendarLabel =
      CALENDAR_TYPES.find((c) => c.value === event.calendarType)?.label ??
      event.calendarType;
    return {
      id: event.id,
      inviteId: row.id,
      rsvpStatus: row.status,
      title: event.title,
      slug: event.slug,
      dateStr,
      timeStr,
      calendarLabel,
      business: event.business,
    };
  });

  return NextResponse.json({ events });
}
