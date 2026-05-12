import { prisma } from "database";
import { publishResaleOfferUpdate } from "@/lib/realtime-publish";
import { scheduleRealtimePublish } from "@/lib/schedule-realtime-publish";
import { resaleOfferRowToLiveSnapshot } from "@/lib/resale-offer-live";

/** If this offer is linked to a resale thread message, push `resale:offer_update` to that room. */
export function scheduleResaleOfferThreadLiveUpdate(offerId: string): void {
  const p = (async () => {
    const msg = await prisma.resaleMessage.findFirst({
      where: { resaleOfferId: offerId },
      select: { id: true, conversationId: true },
    });
    if (!msg) return;
    const offer = await prisma.resaleOffer.findUnique({
      where: { id: offerId },
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
    });
    if (!offer) return;
    await publishResaleOfferUpdate(msg.conversationId, {
      conversationId: msg.conversationId,
      messageId: msg.id,
      resaleOffer: resaleOfferRowToLiveSnapshot(offer),
    });
  })();
  scheduleRealtimePublish(p);
}
