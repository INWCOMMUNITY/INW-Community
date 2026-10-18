"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

type BillingInterval = "monthly" | "yearly";

/** Seller and business plans finish signup before payment. Residents still check out here. */
export function planOnboardingHref(planId: string, interval: BillingInterval = "monthly"): string | null {
  if (planId !== "seller" && planId !== "sponsor") return null;
  const params = new URLSearchParams();
  params.set("enter", planId === "seller" ? "seller" : "business");
  if (interval === "yearly") params.set("billing", "yearly");
  const base = planId === "seller" ? "/signup/seller" : "/signup/business";
  return `${base}?${params.toString()}`;
}

interface CheckoutButtonProps {
  planId: string;
  /** Billing interval (default: monthly) */
  interval?: BillingInterval;
  /** Resident monthly: dollar amount 1–15 (maps to STRIPE_PRICE_SUBSCRIBE_TIER_XX on the server). */
  subscribeTierDollars?: number;
  children?: React.ReactNode;
  className?: string;
}

export function CheckoutButton({
  planId,
  interval = "monthly",
  subscribeTierDollars,
  children = "Subscribe",
  className = "btn",
}: CheckoutButtonProps) {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    const onboardingHref = planOnboardingHref(planId, interval);
    if (onboardingHref) {
      window.location.href = onboardingHref;
      return;
    }
    if (status !== "authenticated" || !session) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search + window.location.hash
          : "/support-nwc"
      )}`;
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { planId, interval };
      if (
        planId === "subscribe" &&
        interval === "monthly" &&
        typeof subscribeTierDollars === "number" &&
        Number.isInteger(subscribeTierDollars)
      ) {
        payload.subscribeTierDollars = subscribeTierDollars;
      }
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search + window.location.hash
            : "/support-nwc"
        )}`;
        return;
      }
      setError(data.error ?? "Could not start checkout. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || status === "loading"}
        className={className}
      >
        {status === "loading"
          ? "Loading…"
          : loading
            ? "Redirecting to checkout…"
            : children}
      </button>
      {error && (
        <p className="mt-2 text-sm font-medium" style={{ color: "#c62828" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
