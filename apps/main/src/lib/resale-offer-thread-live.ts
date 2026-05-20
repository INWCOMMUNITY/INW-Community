import { prisma } from "database";
import { publishResaleOfferUpdate } from "@/lib/realtime-publish";
import { scheduleRealtimePublish } from "@/lib/schedule-realtime-publish";
import { resaleOfferRowToLiveSnapshot } from "@/lib/resale-offer-live";
import type { LiveSocketMessagePayload } from "@/lib/chat-live-types";

/** Serialized thread row returned from PATCH and mirrored in `resale:offer_update`. */
export type ResaleThreadUpdateForClient = {
  detachFromMessageIds: string[];
  message: {
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    resaleOfferId: string | null;
    sender: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    resaleOffer: {
      id: string;
      status: string;
      amountCents: number;
      counterAmountCents: number | null;
      finalAmountCents: number | null;
      respondedAt: string | null;
      acceptedAt: string | null;
      checkoutDeadlineAt: string | null;
    };
  };
};

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function offerActionThreadContent(params: {
  status: string;
  buyerId: string;
  actorMemberId: string;
  counterAmountCents: number | null;
}): string {
  const { status, buyerId, actorMemberId, counterAmountCents } = params;
  const buyerActed = actorMemberId === buyerId;
  if (status === "accepted") {
    return buyerActed ? "Accepted counter offer" : "Offer accepted";
  }
  if (status === "declined") {
    return buyerActed ? "Declined counter offer" : "Offer declined";
  }
  if (status === "countered" && typeof counterAmountCents === "number" && counterAmountCents > 0) {
    return `Counter: ${formatUsd(counterAmountCents)}`;
  }
  return "Offer updated";
}

/**
 * When an offer linked to a resale chat changes, move the offer card to a new message from the actor
 * (like a normal reply) and broadcast `resale:offer_update` with detach + append hints for clients.
 */
export async function finalizeResaleOfferThreadAfterOfferChange(
  offerId: string,
  actorMemberId: string
): Promise<ResaleThreadUpdateForClient | null> {
  const offer = await prisma.resaleOffer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      buyerId: true,
      status: true,
      amountCents: true,
      counterAmountCents: true,
      finalAmountCents: true,
      respondedAt: true,
      acceptedAt: true,
      checkoutDeadlineAt: true,
    },
  });
  if (!offer) return null;

  const linkedBefore = await prisma.resaleMessage.findMany({
    where: { resaleOfferId: offerId },
    select: { id: true, conversationId: true },
    orderBy: { createdAt: "asc" },
  });
  if (linkedBefore.length === 0) return null;

  const conversationId = linkedBefore[0].conversationId;
  const detachFromMessageIds = linkedBefore.map((m) => m.id);

  const content = offerActionThreadContent({
    status: offer.status,
    buyerId: offer.buyerId,
    actorMemberId,
    counterAmountCents: offer.counterAmountCents,
  });

  const created = await prisma.$transaction(async (tx) => {
    await tx.resaleMessage.updateMany({
      where: { resaleOfferId: offerId },
      data: { resaleOfferId: null },
    });
    const msg = await tx.resaleMessage.create({
      data: {
        conversationId,
        senderId: actorMemberId,
        content,
        resaleOfferId: offerId,
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
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
    return msg;
  });

  const ro = created.resaleOffer;
  if (!ro) return null;

  const offerSnap = resaleOfferRowToLiveSnapshot(offer);

  const messageForClient: ResaleThreadUpdateForClient["message"] = {
    id: created.id,
    content: created.content,
    createdAt: created.createdAt.toISOString(),
    senderId: created.senderId,
    resaleOfferId: ro.id,
    sender: {
      id: created.sender.id,
      firstName: created.sender.firstName,
      lastName: created.sender.lastName,
      profilePhotoUrl: created.sender.profilePhotoUrl,
    },
    resaleOffer: {
      id: ro.id,
      status: ro.status,
      amountCents: ro.amountCents,
      counterAmountCents: ro.counterAmountCents,
      finalAmountCents: ro.finalAmountCents,
      respondedAt: ro.respondedAt?.toISOString() ?? null,
      acceptedAt: ro.acceptedAt?.toISOString() ?? null,
      checkoutDeadlineAt: ro.checkoutDeadlineAt?.toISOString() ?? null,
    },
  };

  const newThreadMessage: LiveSocketMessagePayload = {
    conversationId,
    messageId: created.id,
    senderId: created.senderId,
    content: created.content,
    createdAt: created.createdAt.toISOString(),
    sender: {
      id: created.sender.id,
      firstName: created.sender.firstName,
      lastName: created.sender.lastName,
      profilePhotoUrl: created.sender.profilePhotoUrl,
    },
    resaleOffer: offerSnap,
  };

  scheduleRealtimePublish(
    publishResaleOfferUpdate(conversationId, {
      conversationId,
      messageId: created.id,
      resaleOffer: offerSnap,
      detachOfferFromMessageIds: detachFromMessageIds,
      newThreadMessage,
    })
  );

  return {
    detachFromMessageIds,
    message: messageForClient,
  };
}
