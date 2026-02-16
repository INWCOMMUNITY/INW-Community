import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { validateText } from "@/lib/content-moderation";
import { z } from "zod";

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await prisma.directConversation.findMany({
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
        select: { content: true, createdAt: true, senderId: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(conversations);
}

const postBodySchema = z.object({
  addresseeId: z.string().min(1),
  content: z.string().max(5000).optional(),
  sharedContentType: z.enum(["post", "blog", "store_item", "business", "coupon", "reward", "photo"]).optional(),
  sharedContentId: z.string().optional(),
  sharedContentSlug: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  let conversation = await prisma.directConversation.findUnique({
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
    conversation = await prisma.directConversation.create({
      data: { memberAId, memberBId },
      include: {
        memberA: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        memberB: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
        messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
  }

  const hasContent = data.content !== undefined && data.content.trim() !== "";
  const hasShared = data.sharedContentType && data.sharedContentId;
  if (hasContent || hasShared) {
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
    return NextResponse.json(conversation);
  }

  return NextResponse.json(conversation);
}
