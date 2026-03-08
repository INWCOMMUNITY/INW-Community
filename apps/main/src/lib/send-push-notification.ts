/**
 * Send push notifications to app users via Expo Push API.
 * Call after relevant events (message, sale, badge, etc.); fetches member tokens from DB.
 */
import { prisma } from "database";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushPayload {
  title: string;
  body: string;
  /** Optional deep-link data for the app (e.g. { screen: "messages", conversationId: "..." }) */
  data?: Record<string, string | number | boolean>;
}

/**
 * Send a push notification to a member. No-op if member has no registered tokens.
 * Fire-and-forget: errors are logged but not thrown.
 */
export async function sendPushNotification(
  memberId: string,
  payload: PushPayload
): Promise<void> {
  const tokens = await prisma.memberPushToken.findMany({
    where: { memberId },
    select: { token: true, id: true },
  });
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    sound: "default" as const,
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    const json = (await res.json()) as {
      data?: { status: string; message?: string; details?: { error?: string } }[];
    };
    if (!res.ok) {
      console.error("[push]", res.status, json);
      return;
    }
    // Remove tokens that Expo says are invalid (e.g. app uninstalled)
    const data = json.data;
    if (Array.isArray(data)) {
      const toDelete: string[] = [];
      tokens.forEach((t, i) => {
        const receipt = data[i];
        if (receipt?.status === "error") {
          const err = receipt.details?.error ?? receipt.message ?? "";
          if (
            err === "DeviceNotRegistered" ||
            err === "InvalidCredentials" ||
            err.includes("not registered")
          ) {
            toDelete.push(t.id);
          }
        }
      });
      if (toDelete.length > 0) {
        await prisma.memberPushToken.deleteMany({ where: { id: { in: toDelete } } });
      }
    }
  } catch (e) {
    console.error("[push] send failed:", e);
  }
}
