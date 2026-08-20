import { prisma } from "database";
import { getBaseUrl } from "@/lib/get-base-url";
import { enableCommerceNotifications } from "./commerce-notifications";
import { subscribeToEbayNotifications } from "./trading";
import {
  buildEbayWebhookUrl,
  ebayWebhookUrlIsSecured,
  redactEbayWebhookUrl,
} from "./webhook";

export type EbayNotificationConfigPatch = {
  notificationsEnabled: boolean;
  notificationsWebhookUrl?: string;
  notificationsEnabledAt?: string;
  notificationsError?: string;
  commerceNotificationsDestinationId: string | null;
  commerceNotificationSubscriptionIds: string[];
};

export async function subscribeEbayInboundNotifications(accessToken: string): Promise<{
  success: boolean;
  webhookUrl: string;
  error?: string;
  configPatch: EbayNotificationConfigPatch;
}> {
  const webhookUrl = buildEbayWebhookUrl(getBaseUrl());
  if (!process.env.EBAY_WEBHOOK_SECRET?.trim()) {
    console.warn(
      "[ebay] EBAY_WEBHOOK_SECRET is not set; Platform Notification POSTs will be rejected"
    );
  }

  const notifResult = await subscribeToEbayNotifications(accessToken, webhookUrl);
  const commerceNotif = await enableCommerceNotifications(accessToken, webhookUrl).catch((e) => {
    console.warn("[ebay] Commerce Notification API setup failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { destinationId: null, subscriptionIds: [] as string[] };
  });

  const configPatch: EbayNotificationConfigPatch = {
    notificationsEnabled: notifResult.success,
    notificationsWebhookUrl: notifResult.success ? webhookUrl : undefined,
    notificationsEnabledAt: notifResult.success ? new Date().toISOString() : undefined,
    notificationsError: notifResult.error,
    commerceNotificationsDestinationId: commerceNotif.destinationId,
    commerceNotificationSubscriptionIds: commerceNotif.subscriptionIds,
  };

  return {
    success: notifResult.success,
    webhookUrl,
    error: notifResult.error,
    configPatch,
  };
}

/**
 * Re-register Platform Notifications when the stored URL is missing `?secret=`.
 * Safe to call from the channel cron — no-ops when already secured.
 */
export async function ensureEbayPlatformNotifications(args: {
  connectionId: string;
  accessToken: string;
  config: unknown;
}): Promise<{ repaired: boolean; success: boolean }> {
  if (!process.env.EBAY_WEBHOOK_SECRET?.trim()) {
    return { repaired: false, success: false };
  }

  const config = (args.config ?? {}) as Record<string, unknown>;
  const stored =
    typeof config.notificationsWebhookUrl === "string" ? config.notificationsWebhookUrl : null;
  if (config.notificationsEnabled === true && ebayWebhookUrlIsSecured(stored)) {
    return { repaired: false, success: true };
  }

  const result = await subscribeEbayInboundNotifications(args.accessToken);
  await prisma.channelConnection.update({
    where: { id: args.connectionId },
    data: {
      config: {
        ...config,
        ...result.configPatch,
      } as object,
    },
  });

  if (result.success) {
    console.log("[ebay] repaired Platform Notifications URL", {
      connectionId: args.connectionId,
      webhookUrl: redactEbayWebhookUrl(result.webhookUrl),
    });
  } else {
    console.warn("[ebay] Platform Notifications repair failed", {
      connectionId: args.connectionId,
      error: result.error,
    });
  }

  return { repaired: true, success: result.success };
}
