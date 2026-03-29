/**
 * Push events to the standalone realtime service after DB writes.
 *
 * Production: set REALTIME_PUBLISH_URL and REALTIME_PUBLISH_SECRET explicitly.
 * Development: defaults to http://127.0.0.1:3007 and falls back to NEXTAUTH_SECRET
 * for the publish bearer when REALTIME_PUBLISH_SECRET is unset (matches realtime dev default).
 */

export type ChatPublishType =
  | "direct:message"
  | "group:message"
  | "resale:message"
  | "direct:read"
  | "group:read"
  | "resale:read";

let publishDisabledDevWarned = false;
let publishDisabledProdWarned = false;

function resolvePublishTarget(): { base: string; secret: string } {
  const isProd = process.env.NODE_ENV === "production";
  const base =
    process.env.REALTIME_PUBLISH_URL?.trim().replace(/\/+$/, "") ||
    (isProd ? "" : "http://127.0.0.1:3007");
  const secret =
    process.env.REALTIME_PUBLISH_SECRET?.trim() ||
    (isProd ? "" : process.env.NEXTAUTH_SECRET?.trim() || "");
  return { base, secret };
}

async function publishChatEvent(type: ChatPublishType, conversationId: string, payload: Record<string, unknown> = {}): Promise<void> {
  const { base, secret } = resolvePublishTarget();
  if (!base || !secret) {
    if (process.env.NODE_ENV === "development" && !publishDisabledDevWarned) {
      publishDisabledDevWarned = true;
      console.warn(
        "[realtime-publish] Cannot push chat events (missing REALTIME_PUBLISH_URL in prod, or missing NEXTAUTH_SECRET / REALTIME_PUBLISH_SECRET for publish auth). " +
          "Clients can connect but will not receive live updates."
      );
    }
    if (process.env.NODE_ENV === "production" && !publishDisabledProdWarned) {
      publishDisabledProdWarned = true;
      console.warn(
        "[realtime-publish] Skipping live push: set REALTIME_PUBLISH_URL and REALTIME_PUBLISH_SECRET on Vercel (same values as Railway). " +
          "Without them, messages save but other clients do not get socket updates."
      );
    }
    return;
  }

  try {
    const res = await fetch(`${base}/internal/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        type,
        conversationId,
        payload,
      }),
    });
    if (!res.ok) {
      console.warn("[realtime-publish] publish failed", res.status, await res.text().catch(() => ""));
    }
  } catch (e) {
    console.warn("[realtime-publish]", (e as Error)?.message ?? e);
  }
}

export async function publishDirectConversationMessage(conversationId: string, payload: Record<string, unknown> = {}): Promise<void> {
  return publishChatEvent("direct:message", conversationId, payload);
}

export async function publishGroupConversationMessage(conversationId: string, payload: Record<string, unknown> = {}): Promise<void> {
  return publishChatEvent("group:message", conversationId, payload);
}

export async function publishResaleConversationMessage(conversationId: string, payload: Record<string, unknown> = {}): Promise<void> {
  return publishChatEvent("resale:message", conversationId, payload);
}

export async function publishDirectConversationRead(conversationId: string, readerMemberId: string): Promise<void> {
  return publishChatEvent("direct:read", conversationId, { readerMemberId });
}

export async function publishResaleConversationRead(conversationId: string, readerMemberId: string): Promise<void> {
  return publishChatEvent("resale:read", conversationId, { readerMemberId });
}
