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
