"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PolicyPreviewField, SellerPolicyQuestions } from "@/components/seller/SellerPolicyQuestions";
import {
  freeShippingPolicyLead,
  handlingTimeBoldLine,
  policyFromStored,
  showsFreeReturns,
  type SellerReturnLabelPolicy,
} from "@/lib/seller-return-label-policy";
import { clampAcceptReturnsDays } from "@/lib/store-return";

interface PolicyData {
  sellerShippingPolicy?: string | null;
  sellerLocalDeliveryPolicy?: string | null;
  sellerReturnPolicy?: string | null;
  acceptReturns?: boolean;
  acceptReturnsDays?: number;
  chargeReturnShipping?: boolean;
  handlingTime?: string | null;
  returnLabelPayer?: string | null;
  returnLabelPayerByReason?: unknown;
  sellerPolicyName?: string;
  offerShipping?: boolean;
  offerLocalDelivery?: boolean;
  offerFreeShippingOnInw?: boolean;
}

const POLICY_FIELDS: {
  key: keyof PolicyData;
  label: string;
  placeholder: string;
  offerKey?: "offerShipping" | "offerLocalDelivery";
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
];

export default function PoliciesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({
    sellerShippingPolicy: "",
    sellerLocalDeliveryPolicy: "",
    sellerReturnPolicy: "",
  });
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [acceptReturnsDays, setAcceptReturnsDays] = useState(30);
  const [sellerName, setSellerName] = useState("This seller");
  const [offerFreeShippingOnInw, setOfferFreeShippingOnInw] = useState(false);
  const [returnPolicy, setReturnPolicy] = useState<SellerReturnLabelPolicy>(() =>
    policyFromStored({ chargeReturnShipping: false })
  );

  useEffect(() => {
    fetch("/api/me/policies", { credentials: "include" })
      .then((r) => r.json())
      .then((data: PolicyData) => {
        setValues({
          sellerShippingPolicy: data?.sellerShippingPolicy ?? "",
          sellerLocalDeliveryPolicy: data?.sellerLocalDeliveryPolicy ?? "",
          sellerReturnPolicy: data?.sellerReturnPolicy ?? "",
        });
        setOfferShipping(data?.offerShipping ?? true);
        setOfferLocalDelivery(data?.offerLocalDelivery ?? true);
        setAcceptReturnsDays(data?.acceptReturnsDays ?? 30);
        setSellerName(data?.sellerPolicyName?.trim() || "This seller");
        setOfferFreeShippingOnInw(data?.offerFreeShippingOnInw === true);
        setReturnPolicy(policyFromStored(data ?? {}));
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
          sellerPickupPolicy: null,
          sellerReturnPolicy: values.sellerReturnPolicy.trim() || null,
          offerShipping,
          offerLocalDelivery,
          offerLocalPickup: false,
          acceptReturns: true,
          acceptReturnsDays: clampAcceptReturnsDays(acceptReturnsDays),
          handlingTime: returnPolicy.handlingTime,
          returnLabelPayer: returnPolicy.returnLabelPayer,
          returnLabelPayerByReason: returnPolicy.returnLabelPayerByReason,
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
        Set shipping, delivery, and refund policies here. Buyers see these on your storefront.
      </p>

      <form onSubmit={handleSave} className="space-y-6">
        {POLICY_FIELDS.map(({ key, label, placeholder, offerKey, offerLabel }) => (
          <div key={key} className="space-y-2">
            {offerKey && offerLabel && (
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={key + "-offer"}
                  checked={offerKey === "offerShipping" ? offerShipping : offerLocalDelivery}
                  onChange={(e) => {
                    const v = e.target.checked;
                    if (offerKey === "offerShipping") setOfferShipping(v);
                    else setOfferLocalDelivery(v);
                  }}
                  className="rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)] accent-[var(--color-primary)]"
                />
                <label htmlFor={key + "-offer"} className="text-sm font-medium text-gray-700">
                  {offerLabel}
                </label>
              </div>
            )}
            {key === "sellerShippingPolicy" ? (
              <SellerPolicyQuestions
                policy={returnPolicy}
                onChange={setReturnPolicy}
                disabled={saving}
              />
            ) : null}
            {key === "sellerShippingPolicy" ? (
              <PolicyPreviewField
                id={key}
                label={label}
                leads={[freeShippingPolicyLead(offerFreeShippingOnInw)]}
                lead={handlingTimeBoldLine(sellerName, returnPolicy.handlingTime)}
                value={values[key] ?? ""}
                onChange={(text) => setValues((v) => ({ ...v, [key]: text }))}
                placeholder={placeholder}
                disabled={saving}
              />
            ) : key === "sellerLocalDeliveryPolicy" && !offerLocalDelivery ? null : (
              <>
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
              </>
            )}
          </div>
        ))}

        <div className="space-y-4 rounded-lg border border-gray-200 p-4 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Returns & Refunds</h2>
          <label htmlFor="accept-returns-days" className="block text-sm font-medium text-gray-700">
            Accept returns for
          </label>
          <div className="flex items-center gap-2">
            <input
              id="accept-returns-days"
              type="number"
              min={1}
              max={365}
              value={acceptReturnsDays}
              onChange={(e) => setAcceptReturnsDays(clampAcceptReturnsDays(Number(e.target.value)))}
              className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
            />
            <span className="text-sm text-gray-700">days after delivery</span>
          </div>
          <p className="text-sm text-gray-600">
            Mention this return window in your refund policy below.
          </p>
          <PolicyPreviewField
            id="sellerReturnPolicy"
            label="Refund Policy"
            leads={[showsFreeReturns(returnPolicy) ? "FREE RETURNS" : null]}
            value={values.sellerReturnPolicy}
            onChange={(text) => setValues((v) => ({ ...v, sellerReturnPolicy: text }))}
            placeholder="e.g. Returns within 14 days, unused items only."
            disabled={saving}
          />
          <p className="text-sm text-gray-600">
            When the buyer pays, the Shippo return-label price is deducted from the refund after you buy
            the label. You can still choose to pay for a label when you send it.
          </p>
        </div>

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
            Back to Seller Page
          </Link>
        </div>
      </form>
    </div>
  );
}
