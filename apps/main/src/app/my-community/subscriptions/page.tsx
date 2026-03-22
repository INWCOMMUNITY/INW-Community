"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

const PAID_ACCESS_STATUSES = new Set(["active", "trialing", "past_due"]);

function subsLookActive(subs: { status: string }[]) {
  return subs.some((s) => PAID_ACCESS_STATUSES.has(s.status));
}

export default function MySubscriptionsPage() {
  const { data: session, status, update } = useSession();
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFromMe = useCallback(async () => {
    const r = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    const data = await r.json();
    const subs = data?.subscriptions ?? [];
    setHasSubscription(subsLookActive(subs));
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) {
      setHasSubscription(false);
      return;
    }
    refreshFromMe().catch(() => setHasSubscription(false));
  }, [session?.user, status, refreshFromMe]);

  async function handleManage() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/billing-portal", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError(data.error ?? "Could not open billing portal.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncStripe() {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/sync-subscriptions", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setError(typeof data.error === "string" ? data.error : "Sync failed.");
      }
      await refreshFromMe();
      if (typeof update === "function") {
        await update();
      }
    } catch {
      setError("Could not sync with Stripe. Try again in a moment.");
    } finally {
      setSyncing(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <p className="text-gray-600">Loading…</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-4">My Subscriptions</h1>
        <p className="text-gray-600 mb-4">Sign in to view and manage your subscriptions.</p>
        <Link href="/login?callbackUrl=/my-community/subscriptions" className="btn">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">My Subscriptions</h1>
      <p className="text-gray-600 mb-4">
        Open Stripe&apos;s secure billing portal to see your active subscriptions, update payment methods, view invoices, or cancel. All plans tied to your account appear together.
      </p>
      {hasSubscription ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleManage}
            disabled={loading}
            className="btn w-full"
          >
            {loading ? "Opening…" : "Manage subscriptions"}
          </button>
          <button
            type="button"
            onClick={handleSyncStripe}
            disabled={syncing}
            className="btn w-full bg-gray-100 text-gray-900 border border-gray-300 hover:bg-gray-200"
          >
            {syncing ? "Syncing…" : "Refresh list from Stripe"}
          </button>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-gray-600">
            No paid plan shows in your account yet. If you already subscribed, pull the latest from Stripe (fixes delayed webhooks). Otherwise choose a plan below.
          </p>
          <button
            type="button"
            onClick={handleSyncStripe}
            disabled={syncing}
            className="btn w-full"
          >
            {syncing ? "Syncing…" : "Refresh subscriptions from Stripe"}
          </button>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      )}
      <Link href="/support-nwc" className="btn mt-4 inline-block">
        View plans
      </Link>
    </div>
  );
}
