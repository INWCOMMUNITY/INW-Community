import { prisma } from "database";
import { getBaseUrl } from "@/lib/get-base-url";

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function safeSnippet(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function sendDirectMessageFromMember(
  senderId: string,
  recipientId: string,
  content: string
): Promise<void> {
  if (recipientId === senderId) return;

  const [memberAId, memberBId] = normalizePair(senderId, recipientId);
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
    return;
  }

  await prisma.directMessage.create({
    data: {
      conversationId: conv.id,
      senderId,
      content,
    },
  });
  await prisma.directConversation.update({
    where: { id: conv.id },
    data: { updatedAt: new Date() },
  });
}

/**
 * Sends a DM to the invitee with links to accept co-admin (website + app deep link).
 */
export async function sendGroupAdminInviteChatMessage(opts: {
  inviterId: string;
  inviteeId: string;
  groupSlug: string;
  groupName: string;
}): Promise<void> {
  const { inviterId, inviteeId, groupSlug, groupName } = opts;
  const titleShort = safeSnippet(groupName, 80);
  const base = getBaseUrl();
  const webUrl = `${base}/my-community/groups/${groupSlug}/admin?adminInvite=1`;
  const appUrl = `inwcommunity://community/group/${groupSlug}?adminInvite=1`;
  const content = `You're invited to help admin "${titleShort}". Open the link to review and accept:\n${webUrl}\n\nApp: ${appUrl}`;

  try {
    await sendDirectMessageFromMember(inviterId, inviteeId, content);
  } catch (e) {
    console.warn("[sendGroupAdminInviteChatMessage] failed", inviteeId, e);
  }
}

/** Optional DM if co-admin role is granted without a pending invite (not used by invite-admin; co-admins accept via GroupAdminInvite). */
export async function sendGroupCoAdminPromotedChatMessage(opts: {
  inviterId: string;
  inviteeId: string;
  groupSlug: string;
  groupName: string;
}): Promise<void> {
  const { inviterId, inviteeId, groupSlug, groupName } = opts;
  const titleShort = safeSnippet(groupName, 80);
  const base = getBaseUrl();
  const webUrl = `${base}/my-community/groups/${groupSlug}/admin`;
  const appUrl = `inwcommunity://community/group/${groupSlug}`;
  const content = `You've been made a co-admin for "${titleShort}". You can manage the group here:\n${webUrl}\n\nApp: ${appUrl}`;

  try {
    await sendDirectMessageFromMember(inviterId, inviteeId, content);
  } catch (e) {
    console.warn("[sendGroupCoAdminPromotedChatMessage] failed", inviteeId, e);
  }
}
