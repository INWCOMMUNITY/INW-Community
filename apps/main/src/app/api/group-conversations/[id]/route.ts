import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { publishGroupConversationMessage } from "@/lib/realtime-publish";
import { scheduleRealtimePublish } from "@/lib/schedule-realtime-publish";
import type { LiveSocketMessagePayload } from "@/lib/chat-live-types";
import { getBlockedMemberIds } from "@/lib/member-block";
import { validateText } from "@/lib/content-moderation";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { checkMemberRateLimit } from "@/lib/member-rate-limit";
import { z } from "zod";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verifiedGet = await requireVerifiedActiveMember(session.user.id);
  if (!verifiedGet.ok) return verifiedGet.response;

  const { id } = await params;
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 100);

  const conversation = await prisma.groupConversation.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
      members: {
        include: {
          member: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  const isMember = conversation.members.some((m) => m.memberId === session.user.id);
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const blockedIds = await getBlockedMemberIds(session.user.id);
  const otherMemberIds = conversation.members.map((m) => m.memberId).filter((mid) => mid !== session.user.id);
  if (otherMemberIds.some((mid) => blockedIds.has(mid))) {
    return NextResponse.json({ error: "Conversation not available" }, { status: 404 });
  }

  const messages = await prisma.groupConversationMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
  });

  const hasMore = messages.length > limit;
  const result = hasMore ? messages.slice(0, limit) : messages;
  const nextCursor = hasMore ? result[result.length - 1]?.id : null;

  return NextResponse.json({
    ...conversation,
    messages: result,
    nextCursor,
  });
}

const postBodySchema = z.object({
  content: z.string().max(5000).optional(),
  sharedContentType: z
    .enum(["post", "blog", "store_item", "business", "coupon", "reward", "photo", "event"])
    .optional(),
  sharedContentId: z.string().optional(),
  sharedContentSlug: z.string().optional(),
}).refine((d) => (d.content?.trim() ?? "").length > 0 || (d.sharedContentType && d.sharedContentId), {
  message: "Content or shared content required",
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

  const sendRl = checkMemberRateLimit(`gc:send:${session.user.id}`, 120, 60 * 1000);
  if (!sendRl.allowed) {
    return NextResponse.json(
      {
        error: "You are sending messages too quickly. Slow down and try again shortly.",
        code: "RATE_LIMIT",
        retryAfterSec: sendRl.retryAfterSec,
      },
      { status: 429 }
    );
  }

  const { id } = await params;
  const membership = await prisma.groupConversationMember.findUnique({
    where: {
      conversationId_memberId: { conversationId: id, memberId: session.user.id },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let data: z.infer<typeof postBodySchema>;
  try {
    const body = await req.json();
    data = postBodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const contentTrimmed = (data.content ?? "").trim() || "";
  if (contentTrimmed) {
    const contentCheck = validateText(contentTrimmed, "message");
    if (!contentCheck.allowed) {
      const { createFlaggedContent } = await import("@/lib/flag-content");
      await createFlaggedContent({
        contentType: "message",
        contentId: null,
        reason: "slur",
        snippet: contentTrimmed.slice(0, 500),
        authorId: session.user.id,
      });
      return NextResponse.json({ error: contentCheck.reason ?? "Message not allowed." }, { status: 400 });
    }
  }

  const message = await prisma.groupConversationMessage.create({
    data: {
      conversationId: id,
      senderId: session.user.id,
      content: contentTrimmed,
      sharedContentType: data.sharedContentType ?? null,
      sharedContentId: data.sharedContentId ?? null,
      sharedContentSlug: data.sharedContentSlug ?? null,
    },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
    },
  });

  await prisma.groupConversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  const live: LiveSocketMessagePayload = {
    conversationId: id,
    messageId: message.id,
    senderId: message.senderId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    sender: {
      id: message.sender.id,
      firstName: message.sender.firstName,
      lastName: message.sender.lastName,
      profilePhotoUrl: message.sender.profilePhotoUrl,
    },
    sharedContentType: message.sharedContentType,
    sharedContentId: message.sharedContentId,
    sharedContentSlug: message.sharedContentSlug,
  };
  scheduleRealtimePublish(publishGroupConversationMessage(id, live));

  const recipients = await prisma.groupConversationMember.findMany({
    where: { conversationId: id, memberId: { not: session.user.id } },
    select: { memberId: true },
  });
  const convMeta = await prisma.groupConversation.findUnique({
    where: { id },
    select: { name: true },
  });
  const chatLabel = convMeta?.name?.trim() || "Group chat";
  const pushBody =
    contentTrimmed.length > 0
      ? `${message.sender.firstName}: ${contentTrimmed.slice(0, 60)}${contentTrimmed.length > 60 ? "…" : ""}`
      : `${message.sender.firstName} sent a message in ${chatLabel}`;
  const { sendPushNotification } = await import("@/lib/send-push-notification");
  await Promise.all(
    recipients.map((r) =>
      sendPushNotification(r.memberId, {
        title: chatLabel,
        body: pushBody,
        data: { screen: "messages/group", conversationId: id },
        category: "messages",
      }).catch(() => {})
    )
  );

  return NextResponse.json(message);
}
