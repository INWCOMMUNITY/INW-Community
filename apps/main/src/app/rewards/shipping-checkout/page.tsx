"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";

function RewardShippingCheckoutInner() {
  const searchParams = useSearchParams();
  const redemptionId = searchParams.get("redemptionId") ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<{
    rewardTitle: string;
    businessName: string;
    shippingCostCents: number;
  } | null>(null);
  const [street, setStreet] = useState("");
  const [aptOrSuite, setAptOrSuite] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!redemptionId) {
      setError("Missing redemption. Go back to Rewards and redeem again.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/rewards/redemption/${encodeURIComponent(redemptionId)}`, { credentials: "include" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((data as { error?: string }).error ?? "Could not load redemption");
        return data as {
          rewardTitle: string;
          businessName: string;
          shippingCostCents: number;
        };
      })
      .then((d) => {
        if (!cancelled) {
          setSummary(d);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [redemptionId]);

  async function handlePayShipping(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!redemptionId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/stripe/reward-redemption-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          redemptionId,
          shippingAddress: {
            street: street.trim(),
            aptOrSuite: aptOrSuite.trim() || undefined,
            city: city.trim(),
            state: state.trim(),
            zip: zip.trim(),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Checkout failed");
        return;
      }
      const url = (data as { url?: string }).url;
      if (url) {
        window.location.href = url;
        return;
      }
      setError("No checkout URL returned");
    } finally {
      setSubmitting(false);
    }
  }

  if (!redemptionId) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-lg mx-auto">
          <p className="text-red-600 mb-4">{error || "Invalid link."}</p>
          <Link href="/rewards" className="btn inline-block">
            Back to Rewards
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-heading)" }}>
          Complete Shipping for Your Reward
        </h1>
        <p className="text-gray-600 mb-6">
          You already redeemed with Community Points. Pay shipping and tax only so the business can mail your reward.
        </p>
        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : summary ? (
          <>
            <div className="border rounded-lg p-4 mb-6 bg-[var(--color-section-alt)]/40" style={{ borderColor: "var(--color-primary)" }}>
              <p className="font-semibold">{summary.rewardTitle}</p>
              <p className="text-sm text-gray-600">{summary.businessName}</p>
              <p className="mt-2 font-medium">
                Shipping: ${(summary.shippingCostCents / 100).toFixed(2)} + tax at checkout
              </p>
            </div>
            <form onSubmit={handlePayShipping} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Street address *</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  required
                  autoComplete="street-address"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Apt / suite</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  value={aptOrSuite}
                  onChange={(e) => setAptOrSuite(e.target.value)}
                  autoComplete="address-line2"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">City *</label>
                  <input
                    className="w-full border rounded px-3 py-2"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                    autoComplete="address-level2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">State *</label>
                  <input
                    className="w-full border rounded px-3 py-2"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    required
                    autoComplete="address-level1"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">ZIP *</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  required
                  autoComplete="postal-code"
                />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button type="submit" className="btn w-full disabled:opacity-60" disabled={submitting}>
                {submitting ? "Redirecting…" : "Continue to Payment"}
              </button>
            </form>
          </>
        ) : (
          <p className="text-red-600">{error || "Could not load redemption."}</p>
        )}
        <p className="mt-6">
          <Link href="/rewards" className="text-sm font-medium hover:underline" style={{ color: "var(--color-primary)" }}>
            Back to Rewards
          </Link>
        </p>
      </div>
    </section>
  );
}

export default function RewardShippingCheckoutPage() {
  return (
    <Suspense
      fallback={
        <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
          <p className="text-gray-500">Loading…</p>
        </section>
      }
    >
      <RewardShippingCheckoutInner />
    </Suspense>
  );
}
