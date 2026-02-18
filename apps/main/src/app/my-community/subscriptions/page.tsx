"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

export default function MySubscriptionsPage() {
  const { data: session, status } = useSession();
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) {
      setHasSubscription(false);
      return;
    }
    fetch("/api/me")
      .then((r) => r.json())
      .then((data) => {
        const subs = data?.subscriptions ?? [];
        const active = subs.some((s: { status: string }) => s.status === "active");
        setHasSubscription(active);
      })
      .catch(() => setHasSubscription(false));
  }, [session?.user, status]);

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

  if (status === "loading") {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <p className="text-gray-600">Loading…</p>
      </div>
    );
  }

  if (status !== "authenticated") {
    return (
      <div className="max-w-md mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-4">My Subscriptions</h1>
        <p className="text-gray-600 mb-4">Sign in to view and manage your subscriptions.</p>
        <Link href="/login?callbackUrl=/my-community/subscriptions" className="btn">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">My Subscriptions</h1>
      <p className="text-gray-600 mb-4">
        View and manage your subscription. You can update payment methods, view invoices, or cancel your subscription at any time.
      </p>
      {hasSubscription ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleManage}
            disabled={loading}
            className="btn w-full"
          >
            {loading ? "Opening…" : "Manage Subscription"}
          </button>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      ) : (
        <p className="text-gray-600 mb-4">You don&apos;t have an active subscription.</p>
      )}
      <Link href="/support-nwc" className="btn mt-4 inline-block">
        View plans
      </Link>
    </div>
  );
}
