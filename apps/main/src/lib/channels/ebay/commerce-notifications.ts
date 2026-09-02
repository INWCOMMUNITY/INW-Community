import { ebayJson } from "./client";
import { EBAY_APIZ_BASE } from "./config";
import { ebayNotificationVerificationToken } from "./webhook";

export type CommerceNotificationTopic =
  | "MARKETPLACE_ACCOUNT_DELETION"
  | "ITEM_AVAILABILITY"
  | "ITEM_PRICE_REVISION"
  | "ORDER_CONFIRMATION";

const DEFAULT_TOPICS: CommerceNotificationTopic[] = [
  "ITEM_AVAILABILITY",
  "ITEM_PRICE_REVISION",
  "ORDER_CONFIRMATION",
];

type DestinationResponse = {
  destinationId?: string;
};

type SubscriptionResponse = {
  subscriptionId?: string;
};

/** Create or replace a Commerce Notification destination for the seller account. */
export async function ensureCommerceNotificationDestination(
  accessToken: string,
  webhookUrl: string
): Promise<{ destinationId: string | null; error?: string }> {
  try {
    const created = await ebayJson<DestinationResponse>(
      accessToken,
      `${EBAY_APIZ_BASE}/commerce/notification/v1/destination`,
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
    console.warn("[ebay] ensureCommerceNotificationDestination failed", { error });
    return { destinationId: null, error };
  }
}

export async function subscribeCommerceNotificationTopics(
  accessToken: string,
  destinationId: string,
  topics: CommerceNotificationTopic[] = DEFAULT_TOPICS
): Promise<string[]> {
  const ids: string[] = [];
  for (const topic of topics) {
    try {
      const created = await ebayJson<SubscriptionResponse>(
        accessToken,
        `${EBAY_APIZ_BASE}/commerce/notification/v1/subscription`,
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
