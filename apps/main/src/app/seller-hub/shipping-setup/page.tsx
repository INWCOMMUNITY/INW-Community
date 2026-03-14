"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const SHIPPO_LOGIN_URL = "https://apps.goshippo.com/";
const SHIPPO_BILLING_URL = "https://apps.goshippo.com/";
const SHIPPO_API_KEYS_URL = "https://portal.goshippo.com/api-config/api";

export default function SetUpShippoPage() {
  const searchParams = useSearchParams();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [connectedVia, setConnectedVia] = useState<"oauth" | "apiKey" | null>(null);

  useEffect(() => {
    const oauthError = searchParams.get("oauth_error");
    if (oauthError) setError(decodeURIComponent(oauthError));
    if (searchParams.get("connected") === "shippo") {
      setSuccess(true);
      setConnectedVia("oauth");
    }
  }, [searchParams]);

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
        setConnectedVia("apiKey");
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
        <Link
          href="/seller-hub"
          className="text-sm text-gray-600 hover:underline mb-4 inline-block max-md:block max-md:text-center"
        >
          ← Back to Seller Hub
        </Link>
        <h1 className="text-3xl font-bold mb-2 max-md:text-center">Shipping</h1>
        <p className="text-gray-600 mb-8 max-md:text-center">
          Connect your Shippo account once. Then you’ll purchase and print shipping labels right here on Northwest Community—no need to leave the site. Labels are charged to your Shippo account. Add at least one address to your Shippo <strong>Address Book</strong> (Settings → Addresses) so rates and labels work; you can use your own address.
        </p>

        {/* Connect with Shippo (OAuth) */}
        <div className="border-2 rounded-lg p-6 mb-8 border-[var(--color-primary)] bg-white w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
          <h2 className="font-semibold text-lg mb-2">Connect with Shippo</h2>
          <p className="text-gray-600 mb-4 max-md:text-center">
            Sign in or create a Shippo account and connect it to Northwest Community in one click. Easiest option.
          </p>
          <Link
            href="/api/shipping/oauth-start"
            className="btn inline-block"
          >
            Connect with Shippo
          </Link>
        </div>

        {/* Or use API key */}
        <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
          <h2 className="font-semibold text-lg mb-2">Or connect with API key</h2>
          <p className="text-gray-600 mb-4 max-md:text-center">
            If you prefer, create or log in to Shippo, add a payment method and an address to your Address Book, then get an API key and paste it below.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-gray-700 mb-4 max-md:text-left text-sm">
            <li>
              <a href={SHIPPO_LOGIN_URL} target="_blank" rel="noopener noreferrer" className="underline">Log in to Shippo</a> and add payment + Address Book.
            </li>
            <li>
              <a href={SHIPPO_API_KEYS_URL} target="_blank" rel="noopener noreferrer" className="underline">Get your API key</a> (Test or Live).
            </li>
            <li>Paste it below and click Save.</li>
          </ol>
          <textarea
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your Shippo API key (e.g. shippo_live_...)"
            className="w-full border border-gray-300 rounded-lg px-4 py-3 font-mono text-sm min-h-[100px] placeholder:text-gray-400"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3 max-md:justify-center">
            <button type="button" onClick={handleSave} disabled={saving} className="btn">
              {saving ? "Saving…" : "Save & connect"}
            </button>
          </div>
        </div>

        {error && (
          <div className="border rounded-lg p-4 bg-red-50 border-red-200 mb-6 w-full max-md:text-center">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="border rounded-lg p-4 bg-green-50 border-green-200 mb-6 w-full max-md:text-center">
            <p className="text-green-800 font-medium">Shippo connected.</p>
            <p className="text-green-700 text-sm mt-1">
              Select orders and click <strong>Purchase labels</strong> to buy and print on the site. Add at least one address to your Shippo Address Book if you haven’t already.
            </p>
            <Link href="/seller-hub/orders" className="btn mt-4 inline-block">
              Go to My Orders
            </Link>
          </div>
        )}

        <p className="text-sm text-gray-500 max-md:text-center">
          You can return here anytime to reconnect or switch between Connect with Shippo and API key.
        </p>
      </div>
    </section>
  );
}
