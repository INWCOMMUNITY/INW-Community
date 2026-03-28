import { prisma } from "database";

export type EventInviteStats = {
  sent: number;
  attending: number;
  maybe: number;
  declined: number;
};

/**
 * Aggregates EventInvite rows per event (friend invites + RSVPs).
 * `sent` = all invite rows; other fields count by response status (pending excluded from those three).
 */
export async function getEventInviteStatsByEventIds(
  eventIds: string[]
): Promise<Map<string, EventInviteStats>> {
  const map = new Map<string, EventInviteStats>();
  if (eventIds.length === 0) return map;
  for (const id of eventIds) {
    map.set(id, { sent: 0, attending: 0, maybe: 0, declined: 0 });
  }
  const groups = await prisma.eventInvite.groupBy({
    by: ["eventId", "status"],
    where: { eventId: { in: eventIds } },
    _count: { id: true },
  });
  for (const g of groups) {
    const entry = map.get(g.eventId);
    if (!entry) continue;
    const n = g._count.id;
    entry.sent += n;
    if (g.status === "accepted") entry.attending += n;
    else if (g.status === "maybe") entry.maybe += n;
    else if (g.status === "declined") entry.declined += n;
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
