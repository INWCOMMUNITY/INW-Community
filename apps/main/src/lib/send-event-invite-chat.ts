import { prisma } from "database";

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function safeSnippet(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Sends a direct message with shared event card to each invitee (friends-only invites).
 * Does not send push — the event-invite push already notifies the invitee.
 */
export async function sendEventInviteChatMessages(opts: {
  inviterId: string;
  inviteeIds: string[];
  eventId: string;
  eventSlug: string;
  eventTitle: string;
}): Promise<void> {
  const { inviterId, inviteeIds, eventId, eventSlug, eventTitle } = opts;
  const titleShort = safeSnippet(eventTitle, 120);
  const content = `You're invited to "${titleShort}" — open the event to RSVP.`;

  for (const inviteeId of inviteeIds) {
    if (inviteeId === inviterId) continue;
    const [memberAId, memberBId] = normalizePair(inviterId, inviteeId);
    try {
      let conv = await prisma.directConversation.findUnique({
        where: { memberAId_memberBId: { memberAId, memberBId } },
        select: { id: true, status: true },
      });
      if (!conv) {
        conv = await prisma.directConversation.create({
          data: { memberAId, memberBId, status: "accepted", requestedByMemberId: null },
          select: { id: true, status: true },
        });
      } else if (conv.status !== "accepted") {
        continue;
      }

      await prisma.directMessage.create({
        data: {
          conversationId: conv.id,
          senderId: inviterId,
          content,
          sharedContentType: "event",
          sharedContentId: eventId,
          sharedContentSlug: eventSlug,
        },
      });
      await prisma.directConversation.update({
        where: { id: conv.id },
        data: { updatedAt: new Date() },
      });
    } catch (e) {
      console.warn("[sendEventInviteChatMessages] failed for invitee", inviteeId, e);
    }
  }
}
