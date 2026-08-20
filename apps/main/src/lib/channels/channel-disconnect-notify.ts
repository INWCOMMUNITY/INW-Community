import { sendPushNotification } from "@/lib/send-push-notification";
import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";

/** Do not re-push "sync paused" for the same store within this window. */
export const DISCONNECT_NOTIFY_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export function readDisconnectNotifiedAt(config: unknown): Date | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const raw = (config as Record<string, unknown>).disconnectNotifiedAt;
  if (typeof raw !== "string") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Push when a live connection first needs a reconnect — not on every later cron 401,
 * and not again within the cooldown if status was flipped back to active.
 */
export function shouldNotifyChannelDisconnect(
  previousStatus: string | null | undefined,
  lastNotifiedAt?: Date | null,
  now: Date = new Date()
): boolean {
  if (previousStatus === "error") return false;
  if (
    lastNotifiedAt &&
    now.getTime() - lastNotifiedAt.getTime() < DISCONNECT_NOTIFY_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

export async function notifyChannelDisconnectIfNew(args: {
  memberId: string;
  provider: string;
  previousStatus: string | null | undefined;
  lastNotifiedAt?: Date | null;
  now?: Date;
}): Promise<boolean> {
  if (!shouldNotifyChannelDisconnect(args.previousStatus, args.lastNotifiedAt, args.now)) {
    return false;
  }

  const label = CHANNEL_PROVIDER_LABELS[args.provider] ?? args.provider;
  await sendPushNotification(args.memberId, {
    title: `${label} sync paused`,
    body: `INW could not reach your ${label} store. Open this to reconnect. Your INW listings were not deleted.`,
    data: {
      screen: "seller-hub/channels",
      reconnectProvider: args.provider,
    },
    category: "commerce",
  });
  return true;
}
