"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/contexts/AuthContext";
import {
  registerPushTokenWithApi,
  getRouteFromNotificationData,
  type NotificationData,
} from "@/lib/notifications";

const DEDUPE_MS = 4000;
let lastNav: { key: string; at: number } | null = null;

function shouldDeduplicateNav(notificationId: string, route: string): boolean {
  const key = `${notificationId}|${route}`;
  const now = Date.now();
  if (lastNav && lastNav.key === key && now - lastNav.at < DEDUPE_MS) {
    return true;
  }
  lastNav = { key, at: now };
  return false;
}

type PendingNav = { route: string; notificationId: string };

/**
 * When user is logged in, register push token with API.
 * When user taps a notification, navigate after session is ready.
 * Dedupes cold start where getLastNotificationResponseAsync and the tap listener can both fire.
 */
export function PushNotificationHandler() {
  const { member, loading } = useAuth();
  const router = useRouter();
  const memberRef = useRef(member);
  const loadingRef = useRef(loading);
  const pendingRef = useRef<PendingNav | null>(null);
  const coldStartFetchedRef = useRef(false);

  useEffect(() => {
    memberRef.current = member;
    loadingRef.current = loading;
  }, [member, loading]);

  useEffect(() => {
    if (!member?.id) return;
    registerPushTokenWithApi();
  }, [member?.id]);

  const pushRoute = useCallback(
    (route: string, notificationId: string) => {
      if (shouldDeduplicateNav(notificationId, route)) return;
      try {
        router.push(route as never);
      } catch (e) {
        if (__DEV__) console.warn("[PushNotificationHandler] router.push failed", e);
      }
    },
    [router]
  );

  const queueOrPush = useCallback(
    (route: string, notificationId: string) => {
      if (loadingRef.current || !memberRef.current?.id) {
        pendingRef.current = { route, notificationId };
        return;
      }
      pushRoute(route, notificationId);
    },
    [pushRoute]
  );

  /** Tap while app is foreground / background (or cold start before auth finishes). */
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as NotificationData | undefined;
      const route = getRouteFromNotificationData(data ?? null);
      if (!route) return;
      const notificationId = response.notification.request.identifier;
      queueOrPush(route, notificationId);
    });
    return () => sub.remove();
  }, [queueOrPush]);

  /** Quit state → user tapped notification: run after /api/me so routes that need auth work. */
  useEffect(() => {
    if (loading || !member?.id) return;
    if (coldStartFetchedRef.current) return;
    coldStartFetchedRef.current = true;

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as NotificationData | undefined;
        const route = getRouteFromNotificationData(data ?? null);
        if (!route) return;
        const notificationId = response.notification.request.identifier;
        pushRoute(route, notificationId);
      })
      .catch(() => {});
  }, [loading, member?.id, pushRoute]);

  /** Session became ready after notification was queued. */
  useEffect(() => {
    if (loading || !member?.id) return;
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    pushRoute(p.route, p.notificationId);
  }, [loading, member?.id, pushRoute]);

  useEffect(() => {
    if (!member?.id) pendingRef.current = null;
  }, [member?.id]);

  return null;
}
