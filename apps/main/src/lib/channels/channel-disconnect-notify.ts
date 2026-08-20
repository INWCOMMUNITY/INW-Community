import { sendPushNotification } from "@/lib/send-push-notification";
import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";

/** Push once when a connection first flips to error — not on every later cron 401. */
export function shouldNotifyChannelDisconnect(
  previousStatus: string | null | undefined
): boolean {
  return previousStatus !== "error";
}

export async function notifyChannelDisconnectIfNew(args: {
  memberId: string;
  provider: string;
  previousStatus: string | null | undefined;
}): Promise<void> {
  if (!shouldNotifyChannelDisconnect(args.previousStatus)) return;

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
}
