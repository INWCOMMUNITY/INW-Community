import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { isBlocked } from "@/lib/member-block";
import { validateText } from "@/lib/content-moderation";
import { z } from "zod";

function isDirectConversationColumnError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? "");
  return (e as { code?: string })?.code === "P2021" || /member_a_last_read|member_b_last_read|column.*does not exist/i.test(msg);
}

const MESSAGING_NOT_READY = "Messaging is not fully set up yet. Please try again in a few minutes or contact support.";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let conversation;
  try {
    conversation = await prisma.directConversation.findUnique({
      where: { id },
      include: {
        memberA: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        memberB: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: { sender: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
  } catch (e) {
    if (isDirectConversationColumnError(e)) {
      return NextResponse.json({ error: MESSAGING_NOT_READY }, { status: 503 });
    }
    throw e;
  }

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.memberAId !== session.user.id && conversation.memberBId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const otherId = conversation.memberAId === session.user.id ? conversation.memberBId : conversation.memberAId;
  if (await isBlocked(session.user.id, otherId)) {
    return NextResponse.json({ error: "Conversation not available" }, { status: 404 });
  }

  // Enrich messages with shared business data when applicable
  const businessIds = conversation.messages
    .filter((m) => m.sharedContentType === "business" && m.sharedContentId)
    .map((m) => m.sharedContentId as string);
  const businessMap: Record<string, { id: string; name: string; slug: string; logoUrl: string | null; shortDescription: string | null }> = {};
  if (businessIds.length > 0) {
    const businesses = await prisma.business.findMany({
      where: { id: { in: businessIds } },
      select: { id: true, name: true, slug: true, logoUrl: true, shortDescription: true },
    });
    for (const b of businesses) {
      businessMap[b.id] = b;
    }
  }

  const messageIds = conversation.messages.map((m) => m.id);
  let likeCountMap: Record<string, number> = {};
  let likedSet = new Set<string>();
  let likedByMap: Record<string, { id: string; profilePhotoUrl: string | null; firstName: string }[]> = {};
  try {
    const [likeCounts, likedByMe, allLikes] = await Promise.all([
      prisma.directMessageLike.groupBy({
        by: ["messageId"],
        where: { messageId: { in: messageIds } },
        _count: { messageId: true },
      }),
      prisma.directMessageLike.findMany({
        where: { messageId: { in: messageIds }, memberId: session.user.id },
        select: { messageId: true },
      }),
      prisma.directMessageLike.findMany({
        where: { messageId: { in: messageIds } },
        include: { member: { select: { id: true, profilePhotoUrl: true, firstName: true } } },
      }),
    ]);
    likeCountMap = Object.fromEntries(likeCounts.map((l) => [l.messageId, l._count.messageId]));
    likedSet = new Set(likedByMe.map((l) => l.messageId));
    for (const like of allLikes) {
      if (!likedByMap[like.messageId]) likedByMap[like.messageId] = [];
      likedByMap[like.messageId].push({
        id: like.member.id,
        profilePhotoUrl: like.member.profilePhotoUrl,
        firstName: like.member.firstName,
      });
    }
  } catch (e) {
    console.error("[GET direct-conversations] Like enrichment failed:", e);
  }

  const enrichedMessages = conversation.messages.map((m) => {
    const base = { ...m };
    if (m.sharedContentType === "business" && m.sharedContentId && businessMap[m.sharedContentId]) {
      (base as { sharedBusiness?: unknown }).sharedBusiness = businessMap[m.sharedContentId];
    }
    (base as { likeCount?: number; liked?: boolean; likedBy?: { id: string; profilePhotoUrl: string | null; firstName: string }[] }).likeCount = likeCountMap[m.id] ?? 0;
    (base as { liked?: boolean }).liked = likedSet.has(m.id);
    (base as { likedBy?: { id: string; profilePhotoUrl: string | null; firstName: string }[] }).likedBy = likedByMap[m.id] ?? [];
    return base;
  });

  return NextResponse.json({
    ...conversation,
    messages: enrichedMessages,
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

  const { id } = await params;
  let conversation: { id: string; memberAId: string; memberBId: string } | null;
  try {
    conversation = await prisma.directConversation.findUnique({
      where: { id },
      select: { id: true, memberAId: true, memberBId: true },
    });
  } catch (e) {
    if (isDirectConversationColumnError(e)) {
      return NextResponse.json({ error: MESSAGING_NOT_READY }, { status: 503 });
    }
    throw e;
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.memberAId !== session.user.id && conversation.memberBId !== session.user.id) {
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

  const message = await prisma.directMessage.create({
    data: {
      conversationId: id,
      senderId: session.user.id,
      content: contentTrimmed,
      sharedContentType: data.sharedContentType ?? null,
      sharedContentId: data.sharedContentId ?? null,
      sharedContentSlug: data.sharedContentSlug ?? null,
    },
    include: { sender: { select: { id: true, firstName: true, lastName: true } } },
  });

  try {
    await prisma.directConversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  } catch (e) {
    if (isDirectConversationColumnError(e)) {
      console.warn("[POST direct-conversations/[id]] update after send failed (schema):", (e as Error)?.message);
    } else {
      throw e;
    }
  }

  const otherMemberId = conversation.memberAId === session.user.id ? conversation.memberBId : conversation.memberAId;
  const pushBody =
    contentTrimmed.length > 0
      ? `${message.sender.firstName}: ${contentTrimmed.slice(0, 60)}${contentTrimmed.length > 60 ? "…" : ""}`
      : "New message";
  const { sendPushNotification } = await import("@/lib/send-push-notification");
  sendPushNotification(otherMemberId, {
    title: "New message",
    body: pushBody,
    data: { screen: "messages", conversationId: id },
  }).catch(() => {});

  // Test Friend bot: when you message testfriend@nwc.local, they auto-reply " :)"
  let botReply: { id: string; content: string; createdAt: Date; senderId: string; sender: { id: string; firstName: string; lastName: string } } | null = null;
  const testFriend = await prisma.member.findUnique({
    where: { email: "testfriend@nwc.local" },
    select: { id: true },
  });
  if (testFriend && otherMemberId === testFriend.id) {
    const reply = await prisma.directMessage.create({
      data: {
        conversationId: id,
        senderId: testFriend.id,
        content: " :)",
      },
      include: { sender: { select: { id: true, firstName: true, lastName: true } } },
    });
    botReply = reply;
    try {
      await prisma.directConversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
    } catch (e) {
      if (isDirectConversationColumnError(e)) {
        console.warn("[POST direct-conversations/[id]] update after bot reply failed (schema):", (e as Error)?.message);
      } else {
        throw e;
      }
    }
  }

  return NextResponse.json(botReply ? { ...message, botReply } : message);
}

const patchBodySchema = z.object({
  action: z.enum(["accept", "decline"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: z.infer<typeof patchBodySchema>;
  try {
    body = patchBodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  let conversation: { id: string; memberAId: string; memberBId: string; status: string; requestedByMemberId: string | null } | null;
  try {
    conversation = await prisma.directConversation.findUnique({
      where: { id },
      select: { id: true, memberAId: true, memberBId: true, status: true, requestedByMemberId: true },
    });
  } catch (e) {
    if (isDirectConversationColumnError(e)) {
      return NextResponse.json({ error: MESSAGING_NOT_READY }, { status: 503 });
    }
    throw e;
  }
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.status !== "pending" || conversation.requestedByMemberId === session.user.id) {
    return NextResponse.json({ error: "Only the recipient can accept or decline this request" }, { status: 403 });
  }
  const isRecipient =
    conversation.memberAId === session.user.id || conversation.memberBId === session.user.id;
  if (!isRecipient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (body.action === "accept") {
      await prisma.directConversation.update({
        where: { id },
        data: { status: "accepted", requestedByMemberId: null },
      });
      return NextResponse.json({ ok: true, status: "accepted" });
    }
    await prisma.directConversation.delete({ where: { id } });
    return NextResponse.json({ ok: true, status: "declined" });
  } catch (e) {
    if (isDirectConversationColumnError(e)) {
      return NextResponse.json({ error: MESSAGING_NOT_READY }, { status: 503 });
    }
    throw e;
  }
}
