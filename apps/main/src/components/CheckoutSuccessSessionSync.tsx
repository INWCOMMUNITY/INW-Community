"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

const POLL_MS = 2000;
const MAX_MS = 90_000;

/**
 * After Stripe redirects to /my-community?success=1, the webhook may lag a few seconds.
 * Poll /api/me until paid access appears, then refresh the NextAuth client session so
 * Header/Sidebar pick up isSubscriber / canAccessResaleHub without a manual full reload.
 */
export function CheckoutSuccessSessionSync() {
  const searchParams = useSearchParams();
  const { update } = useSession();
  const doneRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncTriesRef = useRef(0);
  const pollCountRef = useRef(0);
  const MAX_STRIPE_SYNC = 3;

  useEffect(() => {
    if (searchParams.get("success") !== "1" || doneRef.current) return;

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const tryStripeSync = async () => {
      if (syncTriesRef.current >= MAX_STRIPE_SYNC) return;
      syncTriesRef.current += 1;
      try {
        await fetch("/api/stripe/sync-subscriptions", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        /* ignore */
      }
    };

    const tick = async () => {
      if (doneRef.current) return;
      try {
        pollCountRef.current += 1;
        if (pollCountRef.current === 2 || pollCountRef.current === 10 || pollCountRef.current === 25) {
          void tryStripeSync();
        }

        const r = await fetch("/api/me", { credentials: "include", cache: "no-store" });
        const me = await r.json();
        const ok =
          me?.hasPaidSubscription === true ||
          me?.isSubscriber === true ||
          (Array.isArray(me?.subscriptions) && me.subscriptions.length > 0);
        if (ok) {
          doneRef.current = true;
          stop();
          if (typeof update === "function") {
            await update();
          } else {
            window.location.reload();
          }
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.delete("success");
            const qs = url.searchParams.toString();
            window.history.replaceState({}, "", url.pathname + (qs ? `?${qs}` : "") + url.hash);
          }
        }
      } catch {
        /* ignore transient errors while polling */
      }
    };

    void tick();
    const started = Date.now();
    intervalRef.current = setInterval(() => {
      if (Date.now() - started > MAX_MS) {
        stop();
        return;
      }
      void tick();
    }, POLL_MS);

    return () => stop();
  }, [searchParams, update]);

  return null;
}
