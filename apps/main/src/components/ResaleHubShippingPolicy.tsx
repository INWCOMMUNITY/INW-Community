"use client";

import { useState, useEffect } from "react";

type PolicyKey = "shipping" | "delivery" | "pickup";

export function ResaleHubShippingPolicy() {
  const [shippingPolicy, setShippingPolicy] = useState("");
  const [localDeliveryPolicy, setLocalDeliveryPolicy] = useState("");
  const [pickupPolicy, setPickupPolicy] = useState("");
  const [saved, setSaved] = useState<PolicyKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: { sellerShippingPolicy?: string | null; sellerLocalDeliveryPolicy?: string | null; sellerPickupPolicy?: string | null }) => {
        setShippingPolicy(data?.sellerShippingPolicy ?? "");
        setLocalDeliveryPolicy(data?.sellerLocalDeliveryPolicy ?? "");
        setPickupPolicy(data?.sellerPickupPolicy ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(key: PolicyKey) {
    setError("");
    setSaving(true);
    setSaved(null);
    const payload: Record<string, string | null> = {};
    if (key === "shipping") payload.sellerShippingPolicy = shippingPolicy.trim() || null;
    if (key === "delivery") payload.sellerLocalDeliveryPolicy = localDeliveryPolicy.trim() || null;
    if (key === "pickup") payload.sellerPickupPolicy = pickupPolicy.trim() || null;
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to save");
        return;
      }
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-10 pt-8 border-t border-gray-200">
        <p className="text-sm text-gray-500">Loading policies…</p>
      </div>
    );
  }

  return (
    <div className="mt-10 pt-8 border-t border-gray-200 space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-2">Shipping policy</h2>
        <p className="text-sm text-gray-600 mb-3">
          Required when you offer shipping. Sync to listings from the list item page.
        </p>
        <textarea
          value={shippingPolicy}
          onChange={(e) => setShippingPolicy(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          placeholder="e.g. 2–5 business days via USPS. Free over $50."
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleSave("shipping")}
            disabled={saving}
            className="btn text-sm py-2 px-4 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved === "shipping" && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Local Delivery policy</h2>
        <p className="text-sm text-gray-600 mb-3">
          Default for local delivery. Sync to listings from the list item page.
        </p>
        <textarea
          value={localDeliveryPolicy}
          onChange={(e) => setLocalDeliveryPolicy(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          placeholder="e.g. Areas served, contact method, timing."
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleSave("delivery")}
            disabled={saving}
            className="btn text-sm py-2 px-4 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved === "delivery" && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Local pickup policy</h2>
        <p className="text-sm text-gray-600 mb-3">
          Where and when buyers can pick up. Sync to listings from the list item page.
        </p>
        <textarea
          value={pickupPolicy}
          onChange={(e) => setPickupPolicy(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          placeholder="e.g. Location, contact method, hours."
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleSave("pickup")}
            disabled={saving}
            className="btn text-sm py-2 px-4 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved === "pickup" && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
