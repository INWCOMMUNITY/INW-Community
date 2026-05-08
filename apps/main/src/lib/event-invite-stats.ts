import { prisma } from "database";

export type EventInviteStats = {
  sent: number;
  attending: number;
  maybe: number;
  declined: number;
};

/**
 * Aggregates EventInvite rows per event (friend invites + RSVPs).
 * `sent` = invites to others only (excludes self-RSVP where inviter === invitee).
 * attending / maybe / declined count all rows with that status (including self-RSVP).
 */
export async function getEventInviteStatsByEventIds(
  eventIds: string[]
): Promise<Map<string, EventInviteStats>> {
  const map = new Map<string, EventInviteStats>();
  if (eventIds.length === 0) return map;
  for (const id of eventIds) {
    map.set(id, { sent: 0, attending: 0, maybe: 0, declined: 0 });
  }
  const rows = await prisma.eventInvite.findMany({
    where: { eventId: { in: eventIds } },
    select: {
      eventId: true,
      status: true,
      inviterId: true,
      inviteeId: true,
    },
  });
  for (const row of rows) {
    const entry = map.get(row.eventId);
    if (!entry) continue;
    if (row.inviterId !== row.inviteeId) entry.sent += 1;
    if (row.status === "accepted") entry.attending += 1;
    else if (row.status === "maybe") entry.maybe += 1;
    else if (row.status === "declined") entry.declined += 1;
  }
  return map;
}

export function isEventOwner(
  ev: {
    memberId: string | null;
    businessId: string | null;
    business: { memberId: string } | null;
  },
  userId: string
): boolean {
  return (
    ev.memberId === userId ||
    (ev.businessId != null && ev.business?.memberId === userId)
  );
}
