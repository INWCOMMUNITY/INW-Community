/**
 * Push notification registration and handling.
 * Uses Expo Notifications; only runs on native (iOS/Android), not web.
 */
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { getOpenChatConversationId } from "./chat-notification-suppression";
import { apiPost } from "./api";

const isNative = Platform.OS === "ios" || Platform.OS === "android";

export type NotificationData = {
  screen?: string;
  conversationId?: string;
  orderId?: string;
  eventSlug?: string;
  eventTitle?: string;
  inviteId?: string;
};

// EAS projectId from app.json extra.eas.projectId (for getExpoPushTokenAsync)
const getProjectId = (): string | undefined => {
  try {
    const c = require("expo-constants").default;
    return c.expoConfig?.extra?.eas?.projectId;
  } catch {
    return undefined;
  }
};

const MESSAGE_SCREENS = new Set(["messages", "resale-hub/messages"]);

function shouldSuppressChatNotification(data: NotificationData | undefined): boolean {
  if (!data?.conversationId) return false;
  const openId = getOpenChatConversationId();
  if (!openId || data.conversationId !== openId) return false;
  return data.screen != null && MESSAGE_SCREENS.has(data.screen);
}

/** Configure how notifications appear when app is in foreground */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as NotificationData | undefined;
    if (shouldSuppressChatNotification(data)) {
      return {
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }
    return {
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

/**
 * Request permission and get Expo push token. Returns token or null if unavailable.
 * Call when user is logged in; then register the token with the API.
 */
export async function getExpoPushTokenAsync(): Promise<string | null> {
  if (!isNative) return null;
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== "granted") return null;

  const projectId = getProjectId();
  try {
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    return tokenData.data ?? null;
  } catch {
    return null;
  }
}

/** Register the current device's push token with the backend. Call when user is logged in. */
export async function registerPushTokenWithApi(): Promise<void> {
  const token = await getExpoPushTokenAsync();
  if (!token) return;
  try {
    await apiPost("/api/me/push-token", {
      token,
      deviceId: Platform.OS === "android" ? (await Device.getDeviceTypeAsync()).toString() : undefined,
    });
  } catch {
    // Ignore (e.g. network or auth)
  }
}

/** Map notification data to app route for navigation */
export function getRouteFromNotificationData(data: NotificationData | null): string | null {
  if (!data?.screen) return null;
  switch (data.screen) {
    case "messages":
      return data.conversationId ? `/messages/${data.conversationId}` : "/messages";
    case "seller-hub/orders":
      return data.orderId ? `/seller-hub/orders/${data.orderId}` : "/seller-hub/orders";
    case "my-badges":
      return "/my-badges";
    case "resale-hub/offers":
      return "/resale-hub/offers";
    case "resale-hub/messages":
      return data.conversationId
        ? `/messages/resale/${data.conversationId}`
        : "/messages?tab=resale";
    case "resale-hub/list":
      return "/resale-hub/list";
    case "community/my-friends":
      return "/community/my-friends";
    case "event":
      return data.eventSlug ? `/event/${data.eventSlug}` : "/calendars/fun_events";
    case "event_invite":
      return data.inviteId
        ? `/community/invites?highlightInvite=${encodeURIComponent(data.inviteId)}`
        : "/community/invites";
    case "event_rsvp":
      return data.eventSlug ? `/event/${data.eventSlug}` : "/community/invites";
    default:
      return null;
  }
}
