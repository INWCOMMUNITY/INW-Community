import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText } from "@/lib/content-moderation";
import { z } from "zod";

const postBodySchema = z.object({
  content: z.string().min(1).max(5000),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await prisma.resaleConversation.findUnique({
    where: { id },
    include: {
      storeItem: { select: { id: true, title: true, slug: true } },
      buyer: { select: { id: true, firstName: true, lastName: true } },
      seller: { select: { id: true, firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { sender: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.buyerId !== session.user.id && conversation.sellerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(conversation);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await prisma.resaleConversation.findUnique({
    where: { id },
    select: { id: true, buyerId: true, sellerId: true },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (conversation.buyerId !== session.user.id && conversation.sellerId !== session.user.id) {
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

  const contentTrimmed = data.content.trim();
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

  const message = await prisma.resaleMessage.create({
    data: {
      conversationId: id,
      senderId: session.user.id,
      content: contentTrimmed,
    },
    include: { sender: { select: { id: true, firstName: true, lastName: true } } },
  });

  await prisma.resaleConversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json(message);
}
