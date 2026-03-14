"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface PolicyData {
  sellerShippingPolicy?: string | null;
  sellerLocalDeliveryPolicy?: string | null;
  sellerPickupPolicy?: string | null;
  sellerReturnPolicy?: string | null;
  offerShipping?: boolean;
  offerLocalDelivery?: boolean;
  offerLocalPickup?: boolean;
}

const POLICY_FIELDS: {
  key: keyof PolicyData;
  label: string;
  placeholder: string;
  offerKey?: "offerShipping" | "offerLocalDelivery" | "offerLocalPickup";
  offerLabel?: string;
}[] = [
  {
    key: "sellerShippingPolicy",
    label: "Shipping Policy",
    placeholder: "e.g. 2–5 business days via USPS. Free over $50.",
    offerKey: "offerShipping",
    offerLabel: "Do you offer shipping?",
  },
  {
    key: "sellerLocalDeliveryPolicy",
    label: "Delivery Policy",
    placeholder: "e.g. Areas served, contact method, timing.",
    offerKey: "offerLocalDelivery",
    offerLabel: "Do you offer local delivery?",
  },
  {
    key: "sellerPickupPolicy",
    label: "Pick-Up Policy",
    placeholder: "e.g. Location, contact method, hours.",
    offerKey: "offerLocalPickup",
    offerLabel: "Do you offer local pickup?",
  },
  {
    key: "sellerReturnPolicy",
    label: "Refund Policy",
    placeholder: "e.g. Returns within 14 days, unused items only.",
  },
];

export default function PoliciesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({
    sellerShippingPolicy: "",
    sellerLocalDeliveryPolicy: "",
    sellerPickupPolicy: "",
    sellerReturnPolicy: "",
  });
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [offerLocalPickup, setOfferLocalPickup] = useState(true);

  useEffect(() => {
    fetch("/api/me/policies", { credentials: "include" })
      .then((r) => r.json())
      .then((data: PolicyData) => {
        setValues({
          sellerShippingPolicy: data?.sellerShippingPolicy ?? "",
          sellerLocalDeliveryPolicy: data?.sellerLocalDeliveryPolicy ?? "",
          sellerPickupPolicy: data?.sellerPickupPolicy ?? "",
          sellerReturnPolicy: data?.sellerReturnPolicy ?? "",
        });
        setOfferShipping(data?.offerShipping ?? true);
        setOfferLocalDelivery(data?.offerLocalDelivery ?? true);
        setOfferLocalPickup(data?.offerLocalPickup ?? true);
      })
      .catch(() => setError("Failed to load policies."))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sellerShippingPolicy: values.sellerShippingPolicy.trim() || null,
          sellerLocalDeliveryPolicy: values.sellerLocalDeliveryPolicy.trim() || null,
          sellerPickupPolicy: values.sellerPickupPolicy.trim() || null,
          sellerReturnPolicy: values.sellerReturnPolicy.trim() || null,
          offerShipping,
          offerLocalDelivery,
          offerLocalPickup,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto min-w-0">
      <h1 className="text-2xl font-bold mb-2">Policies</h1>
      <p className="text-gray-600 mb-6">
        Set your delivery, pick-up, shipping, and refund policies. These apply to your resale and store listings.
      </p>

      <form onSubmit={handleSave} className="space-y-6">
        {POLICY_FIELDS.map(({ key, label, placeholder, offerKey, offerLabel }) => (
          <div key={key} className="space-y-2">
            {offerKey && offerLabel && (
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={key + "-offer"}
                  checked={
                    offerKey === "offerShipping"
                      ? offerShipping
                      : offerKey === "offerLocalDelivery"
                        ? offerLocalDelivery
                        : offerLocalPickup
                  }
                  onChange={(e) => {
                    const v = e.target.checked;
                    if (offerKey === "offerShipping") setOfferShipping(v);
                    else if (offerKey === "offerLocalDelivery") setOfferLocalDelivery(v);
                    else setOfferLocalPickup(v);
                  }}
                  className="rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)] accent-[var(--color-primary)]"
                />
                <label htmlFor={key + "-offer"} className="text-sm font-medium text-gray-700">
                  {offerLabel}
                </label>
              </div>
            )}
            <label htmlFor={key} className="block text-sm font-medium text-gray-700">
              {label}
            </label>
            <textarea
              id={key}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              placeholder={placeholder}
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-500 min-w-0"
            />
          </div>
        ))}

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="btn px-6 py-2.5 disabled:opacity-70"
          >
            {saving ? "Saving…" : saved ? "Saved!" : "Save"}
          </button>
          <Link
            href="/seller-hub/store"
            className="text-gray-600 hover:text-gray-900 text-sm"
          >
            Back to seller page
          </Link>
        </div>
      </form>
    </div>
  );
}
