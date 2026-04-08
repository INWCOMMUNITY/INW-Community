import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getBlockedMemberIds } from "@/lib/member-block";
import { validateText } from "@/lib/content-moderation";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { checkMemberRateLimit } from "@/lib/member-rate-limit";
import { z } from "zod";

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Detect DB errors from missing direct_conversation columns (status, requested_by_member_id, member_*_last_read_at). */
function isDirectConversationSchemaError(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = String((e as { message?: string })?.message ?? "");
  return (
    code === "P2021" ||
    /status|requested_by_member_id|member_a_last_read|member_b_last_read|column.*does not exist/i.test(msg)
  );
}

const MESSAGING_NOT_READY = "Messaging is not fully set up yet. Please try again in a few minutes or contact support.";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  try {
    const [conversations, blockedIds] = await Promise.all([
      prisma.directConversation.findMany({
        where: {
          OR: [
            { memberAId: session.user.id },
            { memberBId: session.user.id },
          ],
        },
        include: {
          memberA: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
          memberB: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, content: true, createdAt: true, senderId: true, sharedContentType: true },
          },
        },
        orderBy: { updatedAt: "desc" },
      }),
      getBlockedMemberIds(session.user.id),
    ]);
    const filtered = conversations.filter((c) => {
      const otherId = c.memberAId === session.user.id ? c.memberBId : c.memberAId;
      return !blockedIds.has(otherId);
    });

    const messageRequests = filtered.filter(
      (c) => c.status === "pending" && c.requestedByMemberId !== session.user.id
    );
    const acceptedList = filtered.filter(
      (c) => c.status === "accepted" || c.requestedByMemberId === session.user.id
    );

    const attachUnread = async (
      list: typeof filtered
    ): Promise<(typeof filtered[number] & { unreadCount: number })[]> =>
      Promise.all(
        list.map(async (c) => {
          const isA = c.memberAId === session.user.id;
          const lastRead = isA ? c.memberALastReadAt : c.memberBLastReadAt;
          const unreadCount = await prisma.directMessage.count({
            where: {
              conversationId: c.id,
              senderId: { not: session.user.id },
              ...(lastRead ? { createdAt: { gt: lastRead } } : {}),
            },
          });
          return { ...c, unreadCount };
        })
      );

    const [conversationsOut, requestsOut] = await Promise.all([
      attachUnread(acceptedList),
      attachUnread(messageRequests),
    ]);

    return NextResponse.json({
      conversations: conversationsOut,
      messageRequests: requestsOut,
    });
  } catch (e: unknown) {
    if (isDirectConversationSchemaError(e)) {
      return NextResponse.json(
        { error: MESSAGING_NOT_READY, conversations: [], messageRequests: [] },
        { status: 503 }
      );
    }
    throw e;
  }
}

const postBodySchema = z.object({
  addresseeId: z.string().min(1),
  content: z.string().max(5000).optional(),
  sharedContentType: z
    .enum(["post", "blog", "store_item", "business", "coupon", "reward", "photo", "event"])
    .optional(),
  sharedContentId: z.string().optional(),
  sharedContentSlug: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  let data: z.infer<typeof postBodySchema>;
  try {
    const body = await req.json();
    data = postBodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  if (data.addresseeId === session.user.id) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
  }

  const addressee = await prisma.member.findUnique({
    where: { id: data.addresseeId },
    select: { id: true, privacyLevel: true },
  });
  if (!addressee) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (addressee.privacyLevel === "completely_private") {
    return NextResponse.json({ error: "Cannot message this member" }, { status: 403 });
  }

  const [memberAId, memberBId] = normalizePair(session.user.id, data.addresseeId);

  let conversation: Awaited<ReturnType<typeof prisma.directConversation.findUnique<{
    where: { memberAId_memberBId: { memberAId: string; memberBId: string } };
    include: {
      memberA: { select: { id: true; firstName: true; lastName: true; profilePhotoUrl: true } };
      memberB: { select: { id: true; firstName: true; lastName: true; profilePhotoUrl: true } };
      messages: { orderBy: { createdAt: "asc" }; include: { sender: { select: { id: true; firstName: true; lastName: true } } } };
    };
  }>>> | null = null;
  try {
    const areFriends = await prisma.friendRequest.findFirst({
      where: {
        status: "accepted",
        OR: [
          { requesterId: session.user.id, addresseeId: data.addresseeId },
          { requesterId: data.addresseeId, addresseeId: session.user.id },
        ],
      },
    });

    conversation = await prisma.directConversation.findUnique({
      where: {
        memberAId_memberBId: { memberAId, memberBId },
      },
      include: {
        memberA: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        memberB: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });

    if (!conversation) {
      const newRl = checkMemberRateLimit(`dm:new:${session.user.id}`, 30, 60 * 60 * 1000);
      if (!newRl.allowed) {
        return NextResponse.json(
          {
            error: "Too many new conversations started. Try again in a little while.",
            code: "RATE_LIMIT",
            retryAfterSec: newRl.retryAfterSec,
          },
          { status: 429 }
        );
      }
      const status = areFriends ? "accepted" : "pending";
      const requestedByMemberId = areFriends ? null : session.user.id;
      conversation = await prisma.directConversation.create({
        data: { memberAId, memberBId, status, requestedByMemberId },
        include: {
          memberA: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
          memberB: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
          messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, firstName: true, lastName: true } } } },
        },
      });
    }
  } catch (e: unknown) {
    if (isDirectConversationSchemaError(e)) {
      return NextResponse.json({ error: MESSAGING_NOT_READY }, { status: 503 });
    }
    throw e;
  }

  const hasContent = data.content !== undefined && data.content.trim() !== "";
  const hasShared = data.sharedContentType && data.sharedContentId;
  if (hasContent || hasShared) {
    const sendRl = checkMemberRateLimit(`dm:send:${session.user.id}`, 120, 60 * 1000);
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
    const contentTrimmed = (data.content ?? "").trim();
    if (contentTrimmed) {
      const contentCheck = validateText(contentTrimmed, "message");
      if (!contentCheck.allowed) {
        return NextResponse.json({ error: contentCheck.reason ?? "Message not allowed." }, { status: 400 });
      }
    }
    const message = await prisma.directMessage.create({
      data: {
        conversationId: conversation.id,
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
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
      conversation = await prisma.directConversation.findUnique({
        where: { id: conversation.id },
        include: {
          memberA: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
          memberB: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
          messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, firstName: true, lastName: true } } } },
        },
      })!;
    } catch (e: unknown) {
      if (isDirectConversationSchemaError(e)) {
        console.warn("[POST direct-conversations] update/refetch after send failed (schema):", (e as Error)?.message);
        if (!conversation) {
          return NextResponse.json({ error: MESSAGING_NOT_READY }, { status: 503 });
        }
        const otherId = conversation.memberAId === session.user.id ? conversation.memberBId : conversation.memberAId;
        const isRequest = conversation.status === "pending";
        const pushTitle = isRequest ? "Somebody wants to chat!" : "New Message!";
        const pushBody =
          contentTrimmed.length > 0
            ? `${message.sender.firstName}: ${contentTrimmed.slice(0, 60)}${contentTrimmed.length > 60 ? "…" : ""}`
            : isRequest
              ? `${message.sender.firstName} sent a message request — tap to accept or decline.`
              : `${message.sender.firstName} messaged you — tap to read.`;
        const { sendPushNotification } = await import("@/lib/send-push-notification");
        sendPushNotification(otherId, {
          title: pushTitle,
          body: pushBody,
          data: { screen: "messages", conversationId: conversation.id },
          category: "messages",
        }).catch(() => {});
        const withNewMessage = { ...conversation, messages: [...(conversation.messages ?? []), message] };
        return NextResponse.json(withNewMessage);
      }
      throw e;
    }
    if (!conversation) {
      return NextResponse.json({ error: MESSAGING_NOT_READY }, { status: 503 });
    }
    const otherId =
      conversation.memberAId === session.user.id ? conversation.memberBId : conversation.memberAId;
    const isRequest = conversation.status === "pending";
    const pushTitle = isRequest ? "Somebody wants to chat!" : "New Message!";
    const pushBody =
      contentTrimmed.length > 0
        ? `${message.sender.firstName}: ${contentTrimmed.slice(0, 60)}${contentTrimmed.length > 60 ? "…" : ""}`
        : isRequest
          ? `${message.sender.firstName} sent a message request — tap to accept or decline.`
          : `${message.sender.firstName} messaged you — tap to read.`;
    const { sendPushNotification } = await import("@/lib/send-push-notification");
    sendPushNotification(otherId, {
      title: pushTitle,
      body: pushBody,
      data: { screen: "messages", conversationId: conversation.id },
      category: "messages",
    }).catch(() => {});
    return NextResponse.json(conversation);
  }

  return NextResponse.json(conversation);
}
