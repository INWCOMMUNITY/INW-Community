import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText } from "@/lib/content-moderation";
import { z } from "zod";

const bodySchema = z.object({
  storeItemId: z.string().min(1),
  content: z.string().min(1).max(5000),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const storeItem = await prisma.storeItem.findUnique({
    where: { id: data.storeItemId },
    select: { id: true, memberId: true, listingType: true },
  });
  if (!storeItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (storeItem.listingType !== "resale") {
    return NextResponse.json({ error: "Messages are only for resale items" }, { status: 400 });
  }

  const sellerId = storeItem.memberId;
  const buyerId = session.user.id;
  if (sellerId === buyerId) {
    return NextResponse.json({ error: "You cannot message yourself" }, { status: 400 });
  }

  let conversation = await prisma.resaleConversation.findUnique({
    where: {
      storeItemId_buyerId: { storeItemId: data.storeItemId, buyerId },
    },
    select: { id: true },
  });

  if (!conversation) {
    conversation = await prisma.resaleConversation.create({
      data: {
        storeItemId: data.storeItemId,
        buyerId,
        sellerId,
      },
      select: { id: true },
    });
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
      conversationId: conversation.id,
      senderId: session.user.id,
      content: contentTrimmed,
    },
  });

  return NextResponse.json({ conversationId: conversation.id, message });
}
