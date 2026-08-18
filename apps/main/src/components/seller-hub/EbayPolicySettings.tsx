"use client";

import { useCallback, useEffect, useState } from "react";

type PolicyOption = { id: string; name: string; enabled?: boolean };

type PoliciesResponse = {
  options: {
    fulfillmentPolicies: PolicyOption[];
    paymentPolicies: PolicyOption[];
    returnPolicies: PolicyOption[];
    merchantLocations: PolicyOption[];
  };
  selected: {
    fulfillmentPolicyId: string | null;
    paymentPolicyId: string | null;
    returnPolicyId: string | null;
    merchantLocationKey: string | null;
  };
  canPublish: boolean;
  publishBlockReason: string | null;
  scopeNotes?: {
    marketplace: string;
    variants: string;
    shipping: string;
  };
};

const selectClass =
  "w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[var(--color-primary)] outline-none";

export function EbayPolicySettings() {
  const [data, setData] = useState<PoliciesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [fulfillmentPolicyId, setFulfillmentPolicyId] = useState("");
  const [paymentPolicyId, setPaymentPolicyId] = useState("");
  const [returnPolicyId, setReturnPolicyId] = useState("");
  const [merchantLocationKey, setMerchantLocationKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/channels/ebay/policies");
      const json = (await res.json()) as PoliciesResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load eBay policies");
      setData(json);
      setFulfillmentPolicyId(json.selected.fulfillmentPolicyId ?? "");
      setPaymentPolicyId(json.selected.paymentPolicyId ?? "");
      setReturnPolicyId(json.selected.returnPolicyId ?? "");
      setMerchantLocationKey(json.selected.merchantLocationKey ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/channels/ebay/policies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fulfillmentPolicyId: fulfillmentPolicyId || null,
          paymentPolicyId: paymentPolicyId || null,
          returnPolicyId: returnPolicyId || null,
          merchantLocationKey: merchantLocationKey || null,
        }),
      });
      const json = (await res.json()) as { error?: string; config?: PoliciesResponse["selected"] };
      if (!res.ok) throw new Error(json.error || "Save failed");
      setMessage("eBay sync settings saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading eBay sync settings…</p>;
  }

  if (error && !data) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!data) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4 mt-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">eBay sync settings</p>
        <p className="text-xs text-gray-600 mt-1">
          Choose which eBay business policies INW uses when publishing and updating listings.
        </p>
      </div>

      {data.scopeNotes ? (
        <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">
          <li>{data.scopeNotes.marketplace}</li>
          <li>{data.scopeNotes.variants}</li>
          <li>{data.scopeNotes.shipping}</li>
        </ul>
      ) : null}

      {!data.canPublish && data.publishBlockReason ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {data.publishBlockReason}
        </p>
      ) : null}

      <label className="block">
        <span className="text-xs font-medium text-gray-700">Shipping / fulfillment policy</span>
        <select
          className={selectClass}
          value={fulfillmentPolicyId}
          onChange={(e) => setFulfillmentPolicyId(e.target.value)}
        >
          <option value="">Select policy…</option>
          {data.options.fulfillmentPolicies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-gray-700">Payment policy</span>
        <select
          className={selectClass}
          value={paymentPolicyId}
          onChange={(e) => setPaymentPolicyId(e.target.value)}
        >
          <option value="">Select policy…</option>
          {data.options.paymentPolicies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-gray-700">Return policy</span>
        <select
          className={selectClass}
          value={returnPolicyId}
          onChange={(e) => setReturnPolicyId(e.target.value)}
        >
          <option value="">Select policy…</option>
          {data.options.returnPolicies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-gray-700">Merchant location</span>
        <select
          className={selectClass}
          value={merchantLocationKey}
          onChange={(e) => setMerchantLocationKey(e.target.value)}
        >
          <option value="">Select location…</option>
          {data.options.merchantLocations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.enabled === false ? " (not enabled)" : ""}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="action-pill action-pill-sm btn-pill-primary disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save eBay sync settings"}
      </button>
    </div>
  );
}
