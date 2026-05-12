import type { LiveResaleOfferSnapshot } from "@/lib/chat-live-types";

export function resaleOfferRowToLiveSnapshot(offer: {
  id: string;
  status: string;
  amountCents: number;
  counterAmountCents: number | null;
  finalAmountCents: number | null;
  respondedAt: Date | null;
  acceptedAt: Date | null;
  checkoutDeadlineAt: Date | null;
}): LiveResaleOfferSnapshot {
  return {
    id: offer.id,
    status: offer.status,
    amountCents: offer.amountCents,
    counterAmountCents: offer.counterAmountCents,
    finalAmountCents: offer.finalAmountCents,
    respondedAt: offer.respondedAt?.toISOString() ?? null,
    acceptedAt: offer.acceptedAt?.toISOString() ?? null,
    checkoutDeadlineAt: offer.checkoutDeadlineAt?.toISOString() ?? null,
  };
}
