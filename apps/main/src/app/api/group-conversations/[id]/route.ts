import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText } from "@/lib/content-moderation";
import { z } from "zod";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  sharedContentType: z.enum(["post", "blog", "store_item", "business", "coupon", "reward", "photo"]).optional(),
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

  return NextResponse.json(message);
}
