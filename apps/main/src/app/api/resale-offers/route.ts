import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { isBlocked } from "@/lib/member-block";
import { publishResaleConversationMessage } from "@/lib/realtime-publish";
import { scheduleRealtimePublish } from "@/lib/schedule-realtime-publish";
import type { LiveSocketMessagePayload } from "@/lib/chat-live-types";
import { resaleOfferRowToLiveSnapshot } from "@/lib/resale-offer-live";
import { z } from "zod";

const createBodySchema = z.object({
  storeItemId: z.string().min(1),
  amountCents: z.number().int().min(1),
  message: z.string().max(2000).optional(),
  conversationId: z.string().min(1).optional(),
});

function offerPreviewContent(amountCents: number): string {
  const priceLabel = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amountCents / 100
  );
  return `Offer: ${priceLabel}`;
}

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: z.infer<typeof createBodySchema>;
  try {
    const body = await req.json();
    data = createBodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const storeItem = await prisma.storeItem.findUnique({
    where: { id: data.storeItemId },
    select: {
      id: true,
      memberId: true,
      title: true,
      listingType: true,
      quantity: true,
      status: true,
      acceptOffers: true,
      minOfferCents: true,
    },
  });
  if (!storeItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (storeItem.listingType !== "resale") {
    return NextResponse.json({ error: "Offers are only allowed on resale items" }, { status: 400 });
  }
  if (!storeItem.acceptOffers) {
    return NextResponse.json({ error: "This seller is not accepting offers on this item" }, { status: 400 });
  }
  if (storeItem.minOfferCents != null && data.amountCents < storeItem.minOfferCents) {
    return NextResponse.json(
      { error: "Offer Below Seller's Minimum Consideration" },
      { status: 400 }
    );
  }
  if (storeItem.memberId === userId) {
    return NextResponse.json({ error: "You cannot make an offer on your own item" }, { status: 400 });
  }
  if (storeItem.quantity < 1 || storeItem.status !== "active") {
    return NextResponse.json({ error: "This item is not available for offers" }, { status: 400 });
  }

  let conversationIdForThread: string | null = null;
  if (data.conversationId) {
    const conv = await prisma.resaleConversation.findUnique({
      where: { id: data.conversationId },
      select: { id: true, storeItemId: true, buyerId: true, sellerId: true },
    });
    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    if (conv.buyerId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (conv.storeItemId !== data.storeItemId) {
      return NextResponse.json({ error: "Conversation does not match this item" }, { status: 400 });
    }
    if (await isBlocked(userId, conv.sellerId)) {
      return NextResponse.json({ error: "Conversation not available" }, { status: 404 });
    }
    conversationIdForThread = conv.id;
  }

  const existing = await prisma.resaleOffer.findFirst({
    where: {
      storeItemId: data.storeItemId,
      buyerId: userId,
      status: "pending",
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: "You already have a pending offer on this item" },
      { status: 400 }
    );
  }

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentOfferCount = await prisma.resaleOffer.count({
    where: {
      storeItemId: data.storeItemId,
      buyerId: userId,
      createdAt: { gte: twentyFourHoursAgo },
    },
  });
  if (recentOfferCount >= 3) {
    return NextResponse.json(
      { error: "You can make up to 3 offers per item every 24 hours. Try again later." },
      { status: 400 }
    );
  }

  const previewLine = offerPreviewContent(data.amountCents);

  const { offer, chatMessage } = await prisma.$transaction(async (tx) => {
    const created = await tx.resaleOffer.create({
      data: {
        storeItemId: data.storeItemId,
        buyerId: userId,
        amountCents: data.amountCents,
        message: data.message?.trim() || null,
        status: "pending",
      },
    });

    let msg: {
      id: string;
      content: string;
      createdAt: Date;
      senderId: string;
      resaleOfferId: string | null;
      sender: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    } | null = null;

    if (conversationIdForThread) {
      msg = await tx.resaleMessage.create({
        data: {
          conversationId: conversationIdForThread,
          senderId: userId,
          content: previewLine,
          resaleOfferId: created.id,
        },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true, profilePhotoUrl: true } },
          resaleOffer: {
            select: {
              id: true,
              status: true,
              amountCents: true,
              counterAmountCents: true,
              finalAmountCents: true,
              respondedAt: true,
              acceptedAt: true,
              checkoutDeadlineAt: true,
            },
          },
        },
      });
      await tx.resaleConversation.update({
        where: { id: conversationIdForThread },
        data: { updatedAt: new Date() },
      });
    }

    return { offer: created, chatMessage: msg };
  });

  const buyer = await prisma.member.findUnique({
    where: { id: userId },
    select: { firstName: true },
  });
  const buyerLabel = buyer?.firstName?.trim() || "Someone";
  const itemLabel = storeItem.title?.trim() || "your listing";
  const priceLabel = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    data.amountCents / 100
  );

  const { sendPushNotification } = await import("@/lib/send-push-notification");
  sendPushNotification(storeItem.memberId, {
    title: "New offer on your listing",
    body: `${buyerLabel} offered ${priceLabel} on “${itemLabel}” — tap to respond.`,
    data: conversationIdForThread
      ? { screen: "resale-hub/messages", conversationId: conversationIdForThread }
      : { screen: "resale-hub/offers" },
    category: "commerce",
  }).catch(() => {});

  if (chatMessage && conversationIdForThread) {
    const live: LiveSocketMessagePayload = {
      conversationId: conversationIdForThread,
      messageId: chatMessage.id,
      senderId: chatMessage.senderId,
      content: chatMessage.content,
      createdAt: chatMessage.createdAt.toISOString(),
      sender: {
        id: chatMessage.sender.id,
        firstName: chatMessage.sender.firstName,
        lastName: chatMessage.sender.lastName,
        profilePhotoUrl: chatMessage.sender.profilePhotoUrl,
      },
      resaleOffer: resaleOfferRowToLiveSnapshot(offer),
    };
    scheduleRealtimePublish(publishResaleConversationMessage(conversationIdForThread, live));
  }

  if (chatMessage) {
    return NextResponse.json({
      offer,
      message: chatMessage,
    });
  }

  return NextResponse.json(offer);
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url ?? "/", "http://localhost");
  const role = searchParams.get("role"); // "buyer" | "seller"
  const statusFilter = searchParams.get("status"); // pending | accepted | declined

  const asSeller = await prisma.resaleOffer.findMany({
    where: {
      storeItem: { memberId: userId },
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: {
      storeItem: { select: { id: true, title: true, slug: true, priceCents: true, photos: true } },
      buyer: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const asBuyer = await prisma.resaleOffer.findMany({
    where: { buyerId: userId, ...(statusFilter ? { status: statusFilter } : {}) },
    include: {
      storeItem: { select: { id: true, title: true, slug: true, priceCents: true, photos: true, memberId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  if (role === "seller") {
    return NextResponse.json(asSeller);
  }
  if (role === "buyer") {
    return NextResponse.json(asBuyer);
  }
  return NextResponse.json({ asSeller, asBuyer });
}
