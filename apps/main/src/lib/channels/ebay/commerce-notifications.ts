import { ebayAction, ebayJson } from "./client";
import { ebayNotificationVerificationToken } from "./webhook";

/** Notification API is on api.ebay.com, not apiz (identity/media). Relative paths use EBAY_API_BASE. */
const NOTIFICATION_DESTINATION = "/commerce/notification/v1/destination";
const NOTIFICATION_SUBSCRIPTION = "/commerce/notification/v1/subscription";

export type CommerceNotificationTopic =
  | "MARKETPLACE_ACCOUNT_DELETION"
  | "ITEM_AVAILABILITY"
  | "ITEM_PRICE_REVISION"
  | "ORDER_CONFIRMATION";

export const EBAY_COMMERCE_WEBHOOK_TOPICS: CommerceNotificationTopic[] = [
  "ORDER_CONFIRMATION",
];

type DestinationResponse = {
  destinationId?: string;
};

type SubscriptionResponse = {
  subscriptionId?: string;
};

/** Create or replace a Commerce Notification destination for the seller account. */
export function isEbayCommerceNotificationPermissionError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /#1100|HTTP 403|insufficient permissions/i.test(error);
}

export async function ensureCommerceNotificationDestination(
  accessToken: string,
  webhookUrl: string
): Promise<{ destinationId: string | null; error?: string }> {
  try {
    const created = await ebayJson<DestinationResponse>(
      accessToken,
      NOTIFICATION_DESTINATION,
      "POST",
      {
        name: "INW Commerce Notifications",
        status: "ENABLED",
        deliveryConfig: {
          endpoint: webhookUrl,
          verificationToken: ebayNotificationVerificationToken() || undefined,
        },
      }
    );
    const destinationId = created.destinationId?.trim() || null;
    return destinationId
      ? { destinationId }
      : { destinationId: null, error: "destination-create-empty-id" };
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400);
    if (isEbayCommerceNotificationPermissionError(error)) {
      console.log("[ebay] Commerce Notification API not granted for this token; Platform Notifications still used", {
        error,
      });
    } else {
      console.warn("[ebay] ensureCommerceNotificationDestination failed", { error });
    }
    return { destinationId: null, error };
  }
}

export async function subscribeCommerceNotificationTopics(
  accessToken: string,
  destinationId: string,
  topics: CommerceNotificationTopic[] = EBAY_COMMERCE_WEBHOOK_TOPICS
): Promise<string[]> {
  const ids: string[] = [];
  for (const topic of topics) {
    try {
      const created = await ebayJson<SubscriptionResponse>(
        accessToken,
        NOTIFICATION_SUBSCRIPTION,
        "POST",
        {
          topicId: topic,
          destinationId,
          status: "ENABLED",
        }
      );
      if (created.subscriptionId) ids.push(created.subscriptionId);
    } catch (e) {
      console.warn("[ebay] subscribeCommerceNotificationTopics failed", {
        topic,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return ids;
}

export async function enableCommerceNotifications(
  accessToken: string,
  webhookUrl: string
): Promise<{ destinationId: string | null; subscriptionIds: string[]; error?: string }> {
  const dest = await ensureCommerceNotificationDestination(accessToken, webhookUrl);
  if (!dest.destinationId) {
    return {
      destinationId: null,
      subscriptionIds: [],
      error: dest.error || "destination-create-failed",
    };
  }
  const subscriptionIds = await subscribeCommerceNotificationTopics(accessToken, dest.destinationId);
  return {
    destinationId: dest.destinationId,
    subscriptionIds,
    ...(subscriptionIds.length === 0 ? { error: "destination-ok-subscriptions-empty" } : {}),
  };
}

function readCommerceNotificationIds(config: unknown): {
  destinationId: string | null;
  subscriptionIds: string[];
} {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { destinationId: null, subscriptionIds: [] };
  }
  const row = config as Record<string, unknown>;
  const destinationId =
    typeof row.commerceNotificationsDestinationId === "string"
      ? row.commerceNotificationsDestinationId.trim() || null
      : null;
  const raw = row.commerceNotificationSubscriptionIds;
  const subscriptionIds = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
    : [];
  return { destinationId, subscriptionIds };
}

/** Best-effort: disable Commerce REST notifications so disconnect does not leave a live destination. */
export async function disableEbayCommerceNotifications(
  accessToken: string,
  config: unknown
): Promise<void> {
  const { destinationId, subscriptionIds } = readCommerceNotificationIds(config);
  for (const subscriptionId of subscriptionIds) {
    await ebayAction(
      accessToken,
      `${NOTIFICATION_SUBSCRIPTION}/${encodeURIComponent(subscriptionId)}`,
      "DELETE"
    ).catch((e) =>
      console.warn("[ebay] disable commerce subscription failed", {
        subscriptionId,
        error: e instanceof Error ? e.message : String(e),
      })
    );
  }
  if (!destinationId) return;
  await ebayJson(accessToken, `${NOTIFICATION_DESTINATION}/${encodeURIComponent(destinationId)}`, "PUT", {
    status: "DISABLED",
  }).catch((e) =>
    console.warn("[ebay] disable commerce destination failed", {
      destinationId,
      error: e instanceof Error ? e.message : String(e),
    })
  );
}
