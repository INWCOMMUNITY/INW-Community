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

/** Matches web `messages/page.tsx` — pending row until API/socket confirms. */
export const OPTIMISTIC_MSG_ID_PREFIX = "__optimistic__";
export function newOptimisticMessageId(): string {
  return `${OPTIMISTIC_MSG_ID_PREFIX}${Date.now()}`;
}
