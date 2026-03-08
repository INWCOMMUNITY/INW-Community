"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/contexts/AuthContext";
import {
  registerPushTokenWithApi,
  getRouteFromNotificationData,
  type NotificationData,
} from "@/lib/notifications";

/**
 * When user is logged in, register push token with API.
 * When user taps a notification, navigate to the relevant screen.
 */
export function PushNotificationHandler() {
  const { member } = useAuth();
  const router = useRouter();
  const hasHandledInitial = useRef(false);

  useEffect(() => {
    if (!member?.id) return;
    registerPushTokenWithApi();
  }, [member?.id]);

  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as NotificationData | undefined;
      const route = getRouteFromNotificationData(data ?? null);
      if (route) {
        router.push(route as never);
      }
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (hasHandledInitial.current) return;
    hasHandledInitial.current = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as NotificationData | undefined;
        const route = getRouteFromNotificationData(data ?? null);
        if (route) {
          setTimeout(() => router.push(route as never), 100);
        }
      })
      .catch(() => {});
  }, [router]);

  return null;
}
