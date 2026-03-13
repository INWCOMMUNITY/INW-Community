"use client";

import { useState } from "react";
import Link from "next/link";

const SHIPPO_LOGIN_URL = "https://apps.goshippo.com/";
const SHIPPO_BILLING_URL = "https://apps.goshippo.com/";
const SHIPPO_API_KEYS_URL = "https://portal.goshippo.com/api-config/api";

export default function SetUpShippoPage() {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    const key = apiKey.trim();
    if (!key) {
      setError("Please paste your Shippo API key.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/shipping/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess(true);
        setApiKey("");
      } else {
        setError((data as { error?: string }).error ?? "Failed to connect. Please check your API key.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="py-6 w-full max-md:px-4 max-md:box-border max-md:flex max-md:flex-col max-md:items-center">
      <div className="w-full max-w-[var(--max-width)] max-md:mx-auto max-md:flex max-md:flex-col max-md:items-center">
        <Link href="/seller-hub" className="text-sm text-gray-600 hover:underline mb-4 inline-block max-md:block max-md:text-center">
          ← Back to Seller Hub
        </Link>
        <h1 className="text-3xl font-bold mb-2 max-md:text-center">Set Up Shippo</h1>
        <p className="text-gray-600 mb-8 max-md:text-center">
          Each seller connects their own Shippo account and API key to get rates and buy labels; labels are charged to your Shippo account. Add a return address in Shippo to get rates. New Shippo accounts may take a few hours before a Live API key is available; you can use a Test key first to try the flow.
        </p>

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 1: Log in to Shippo</h2>
        <p className="mb-4">
          Create or log in to your Shippo account.
        </p>
        <a
          href={SHIPPO_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn inline-block"
        >
          Open Shippo →
        </a>
      </div>

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 2: Set up payment</h2>
        <p className="mb-4 text-gray-700">
          Add a payment method in Shippo so you can pay for labels. Labels are charged to your Shippo account.
        </p>
        <a
          href={SHIPPO_BILLING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn inline-block"
        >
          Open Shippo →
        </a>
      </div>

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 3: Add a return address</h2>
        <p className="mb-4 text-gray-700">
          In Shippo, add at least one address (your return/ship-from address). You need this to get rates and buy labels.
        </p>
        <a
          href={SHIPPO_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn inline-block"
        >
          Open Shippo to add address →
        </a>
      </div>

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 4: Get your API key</h2>
        <ol className="list-decimal list-inside space-y-2 text-gray-700 mb-4 max-md:text-left">
          <li>Open the Shippo API Portal (Developer Keys).</li>
          <li>Create a <strong>Test</strong> key to try the flow, or a <strong>Live</strong> key for real labels (new accounts may take a few hours before Live keys are available).</li>
          <li>Copy the key; you can only see it once.</li>
        </ol>
        <a
          href={SHIPPO_API_KEYS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-link)] hover:underline"
        >
          Open Shippo API Keys →
        </a>
      </div>

      <div className="border rounded-lg p-6 mb-8 bg-white border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 5: Paste your API key here</h2>
        <p className="text-gray-600 mb-4">
          Paste your Shippo API key below. It is stored securely and used only to get rates and purchase labels. Shippo charges your card when you buy a label.
        </p>
        <textarea
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste your Shippo API key (e.g. shippo_live_...)"
          className="w-full border border-gray-300 rounded-lg px-4 py-3 font-mono text-sm min-h-[120px] placeholder:text-gray-400"
          spellCheck={false}
          autoComplete="off"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3 max-md:justify-center">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn"
          >
            {saving ? "Saving…" : "Save & connect"}
          </button>
          <Link href="/seller-hub/ship" className="text-gray-600 hover:underline text-sm">
            Cancel and go to Ship Items
          </Link>
        </div>
      </div>

      {error && (
        <div className="border rounded-lg p-4 bg-red-50 border-red-200 mb-6 w-full max-md:text-center">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="border rounded-lg p-4 bg-green-50 border-green-200 mb-6 w-full max-md:text-center">
          <p className="text-green-800 font-medium">Shippo account connected.</p>
          <p className="text-green-700 text-sm mt-1">
            You can now get rates and buy labels from the{" "}
            <Link href="/seller-hub/ship" className="underline hover:no-underline">
              Ship Items
            </Link>{" "}
            page. Add a return address in Shippo if you haven’t already. Labels will be charged to your Shippo account.
          </p>
        </div>
      )}

      <p className="text-sm text-gray-500 max-md:text-center">
        You can return to this page anytime to update your API key.
      </p>
      </div>
    </section>
  );
}
