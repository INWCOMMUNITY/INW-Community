/** Serialized resale offer fields for Socket.IO (new message or offer_update). */
export type LiveResaleOfferSnapshot = {
  id: string;
  status: string;
  amountCents: number;
  counterAmountCents: number | null;
  finalAmountCents: number | null;
  respondedAt: string | null;
  acceptedAt: string | null;
  checkoutDeadlineAt: string | null;
};

/** Payload for `resale:offer_update` — merge into existing message bubble by `messageId`. */
export type LiveResaleOfferUpdatePayload = {
  conversationId: string;
  messageId: string;
  resaleOffer: LiveResaleOfferSnapshot;
};

export function isLiveResaleOfferUpdatePayload(p: unknown): p is LiveResaleOfferUpdatePayload {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  if (typeof o.conversationId !== "string" || typeof o.messageId !== "string") return false;
  const ro = o.resaleOffer;
  if (!ro || typeof ro !== "object") return false;
  const r = ro as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.status === "string" &&
    typeof r.amountCents === "number"
  );
}

/**
 * Payload merged into Socket.IO chat events so clients can append messages without refetching.
 */
export type LiveSocketMessagePayload = {
  conversationId: string;
  messageId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender?: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl?: string | null;
  };
  /** When set, thread should render an offer card bound to this offer row. */
  resaleOffer?: LiveResaleOfferSnapshot | null;
  sharedContentType?: string | null;
  sharedContentId?: string | null;
  sharedContentSlug?: string | null;
  /** Present when sharedContentType is "event" — rich preview in chat. */
  sharedEvent?: {
    id: string;
    title: string;
    slug: string;
    coverPhotoUrl: string | null;
  };
  sharedStoreItem?: {
    id: string;
    title: string;
    slug: string;
    coverPhotoUrl: string | null;
    listingType: string;
  };
  sharedBusiness?: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    shortDescription: string | null;
  };
};

export function isLiveSocketMessagePayload(p: unknown): p is LiveSocketMessagePayload {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.conversationId === "string" &&
    typeof o.messageId === "string" &&
    typeof o.senderId === "string" &&
    typeof o.content === "string" &&
    typeof o.createdAt === "string"
  );
}
