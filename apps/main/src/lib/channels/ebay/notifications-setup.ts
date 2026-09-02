import { prisma } from "database";
import { patchChannelConnectionConfig } from "../connection";
import { getBaseUrl } from "@/lib/get-base-url";
import { enableCommerceNotifications } from "./commerce-notifications";
import { getEbayNotificationPreferences, subscribeToEbayNotifications } from "./trading";
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
  lastCommerceNotificationsError?: string | null;
};

export function readEbayWebhookReceipt(config: unknown): {
  lastEbayWebhookAt: string | null;
  lastEbayWebhookEvent: string | null;
  lastEbayWebhookHitAt: string | null;
  lastEbayWebhookHitReason: string | null;
} {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      lastEbayWebhookAt: null,
      lastEbayWebhookEvent: null,
      lastEbayWebhookHitAt: null,
      lastEbayWebhookHitReason: null,
    };
  }
  const c = config as Record<string, unknown>;
  return {
    lastEbayWebhookAt: typeof c.lastEbayWebhookAt === "string" ? c.lastEbayWebhookAt : null,
    lastEbayWebhookEvent: typeof c.lastEbayWebhookEvent === "string" ? c.lastEbayWebhookEvent : null,
    lastEbayWebhookHitAt: typeof c.lastEbayWebhookHitAt === "string" ? c.lastEbayWebhookHitAt : null,
    lastEbayWebhookHitReason: typeof c.lastEbayWebhookHitReason === "string" ? c.lastEbayWebhookHitReason : null,
  };
}

/** Stamp every inbound POST, including 401s, so we can tell delivery from apply. */
export async function recordEbayWebhookHit(reason: string): Promise<void> {
  const conns = await prisma.channelConnection.findMany({
    where: { provider: "ebay", status: { not: "disconnected" } },
    select: { id: true },
    take: 20,
  });
  const at = new Date().toISOString();
  await Promise.all(
    conns.map((c) =>
      patchChannelConnectionConfig(c.id, {
        lastEbayWebhookHitAt: at,
        lastEbayWebhookHitReason: reason,
      }).catch(() => {})
    )
  );
}

export async function recordEbayWebhookReceipt(
  connectionId: string,
  _currentConfig: unknown,
  eventType: string | null
): Promise<void> {
  await patchChannelConnectionConfig(connectionId, {
    lastEbayWebhookAt: new Date().toISOString(),
    ...(eventType ? { lastEbayWebhookEvent: eventType } : {}),
  }).catch((e) =>
    console.warn("[ebay] recordEbayWebhookReceipt failed", {
      connectionId,
      error: e instanceof Error ? e.message : String(e),
    })
  );
}

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
    lastCommerceNotificationsError: commerceNotif.error ?? null,
  };

  return {
    success: notifResult.success,
    webhookUrl,
    error: notifResult.error,
    configPatch,
  };
}

/**
 * Re-register Platform Notifications when the stored URL is missing `?secret=`
 * or live eBay prefs show delivery disabled / an unsecured URL.
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
  const storedLooksOk = config.notificationsEnabled === true && ebayWebhookUrlIsSecured(stored);

  const commerceIds = config.commerceNotificationSubscriptionIds;
  const hasCommerce =
    Array.isArray(commerceIds) && commerceIds.some((id) => typeof id === "string" && id.trim());

  if (storedLooksOk) {
    const live = await getEbayNotificationPreferences(args.accessToken);
    if (!live.fetched) {
      return { repaired: false, success: true };
    }
    if (live.subscribed && live.urlSecured && hasCommerce) {
      return { repaired: false, success: true };
    }
  }

  const result = await subscribeEbayInboundNotifications(args.accessToken);
  await patchChannelConnectionConfig(
    args.connectionId,
    result.configPatch as Record<string, unknown>
  );

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
