"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

type BillingInterval = "monthly" | "yearly";

interface CheckoutButtonProps {
  planId: string;
  /** Billing interval (default: monthly) */
  interval?: BillingInterval;
  children?: React.ReactNode;
  className?: string;
}

export function CheckoutButton({
  planId,
  interval = "monthly",
  children = "Subscribe",
  className = "btn",
}: CheckoutButtonProps) {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (status !== "authenticated" || !session) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(
        typeof window !== "undefined" ? window.location.pathname + window.location.search : "/support-nwc"
      )}`;
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, interval }),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(
          typeof window !== "undefined" ? window.location.pathname : "/support-nwc"
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
