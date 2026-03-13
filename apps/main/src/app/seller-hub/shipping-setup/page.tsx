"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type ReturnAddress = { name?: string; street1?: string; street2?: string; city?: string; state?: string; zip?: string; company?: string };

const EASYPOST_LOGIN_URL = "https://www.easypost.com/login";
const EASYPOST_BILLING_URL = "https://www.easypost.com/account/billing";
const EASYPOST_API_KEYS_URL = "https://www.easypost.com/account/api-keys";

export default function SetUpEasyPostPage() {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [returnAddr, setReturnAddr] = useState<ReturnAddress>({ name: "", street1: "", street2: "", city: "", state: "", zip: "", company: "" });
  const [returnAddrSaving, setReturnAddrSaving] = useState(false);
  const [returnAddrSuccess, setReturnAddrSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/shipping/return-address", { credentials: "include" })
      .then((r) => r.json())
      .then((data: ReturnAddress | null) => {
        if (data && typeof data === "object")
          setReturnAddr({
            name: data.name ?? "",
            street1: data.street1 ?? "",
            street2: data.street2 ?? "",
            city: data.city ?? "",
            state: data.state ?? "",
            zip: data.zip ?? "",
            company: data.company ?? "",
          });
      })
      .catch(() => {});
  }, []);

  async function handleSaveReturnAddress() {
    if (!returnAddr.street1?.trim() || !returnAddr.city?.trim() || !returnAddr.state?.trim() || !returnAddr.zip?.trim()) {
      setError("Street, city, state, and ZIP are required for the return address.");
      return;
    }
    const nameOrCompany = (returnAddr.name ?? "").trim() || (returnAddr.company ?? "").trim();
    if (!nameOrCompany) {
      setError("Name or company is required for shipping labels (at least one).");
      return;
    }
    setReturnAddrSaving(true);
    setError(null);
    setReturnAddrSuccess(false);
    try {
      const res = await fetch("/api/shipping/return-address", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(returnAddr),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setReturnAddrSuccess(true);
      else setError((data as { error?: string }).error ?? "Failed to save return address.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setReturnAddrSaving(false);
    }
  }

  async function handleSave() {
    const key = apiKey.trim();
    if (!key) {
      setError("Please paste your EasyPost API key.");
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
        <h1 className="text-3xl font-bold mb-2 max-md:text-center">Set Up Easy Post</h1>
        <p className="text-gray-600 mb-8 max-md:text-center">
          Connect your EasyPost account so you can get shipping rates and buy labels from this site.
          Labels are charged to your EasyPost account (your card).
        </p>

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 1: Log in to Easy Post</h2>
        <p className="mb-4">
          If you don’t have an EasyPost account, create one first. Then log in to get your API key.
        </p>
        <a
          href={EASYPOST_LOGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn inline-block"
        >
          Open Easy Post login →
        </a>
      </div>

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 2: Set up payment options</h2>
        <p className="mb-4 text-gray-700">
          Add a payment method (card or bank account) in your EasyPost account so you can pay for labels. Labels are charged to your EasyPost account.
        </p>
        <a
          href={EASYPOST_BILLING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn inline-block"
        >
          Open Easy Post Billing →
        </a>
      </div>

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 3: Get your API key</h2>
        <ol className="list-decimal list-inside space-y-2 text-gray-700 mb-4 max-md:text-left">
          <li>After logging in, go to your account settings.</li>
          <li>
            Open the <strong>API Keys</strong> page (or go directly to the link below).
          </li>
          <li>
            Create a new API key if needed, or copy an existing <strong>Production</strong> key.
          </li>
          <li>Use a Production key so you can buy real labels. Test keys only work for test labels.</li>
        </ol>
        <a
          href={EASYPOST_API_KEYS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-link)] hover:underline"
        >
          Open Easy Post API Keys page →
        </a>
      </div>

      <div className="border rounded-lg p-6 mb-8 bg-white border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-4">Step 4: Paste your API key here</h2>
        <p className="text-gray-600 mb-4">
          Paste your EasyPost API key in the box below. It will be stored securely and used only to
          get rates and purchase labels on your behalf. We never charge your card directly—EasyPost
          charges your card when you buy a label.
        </p>
        <textarea
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Paste your EasyPost API key (e.g. EZAK...)"
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

      <div className="border rounded-lg p-6 mb-8 bg-gray-50 border-gray-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h2 className="font-semibold text-lg mb-2">Step 5: Set up return address</h2>
        <p className="text-gray-600 mb-4 text-sm">
          Enter the return address you use in your EasyPost account. This is used only for shipping labels and packing slips—not your storefront address.
        </p>
        <p className="text-gray-600 mb-3 text-sm max-w-md">
          <strong>Name or company is required</strong> for shipping labels (at least one).
        </p>
        <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200 text-left max-w-md">
          <p className="text-amber-900 text-sm font-medium">
            Copy the <strong>exact same</strong> address from your EasyPost account.
          </p>
          <p className="text-amber-800 text-sm mt-1">
            Use the same spelling, abbreviations, and formatting (e.g. “St” vs “Street”, “CA” vs “California”). If this address doesn’t match EasyPost’s records, label purchase can fail with an address verification error.
          </p>
        </div>
        <div className="grid gap-3 max-w-md">
          <input
            type="text"
            placeholder="Name * (or company below)"
            value={returnAddr.name ?? ""}
            onChange={(e) => setReturnAddr((a) => ({ ...a, name: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Company * (or name above)"
            value={returnAddr.company ?? ""}
            onChange={(e) => setReturnAddr((a) => ({ ...a, company: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Street address *"
            value={returnAddr.street1 ?? ""}
            onChange={(e) => setReturnAddr((a) => ({ ...a, street1: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Apt, suite, etc. (optional)"
            value={returnAddr.street2 ?? ""}
            onChange={(e) => setReturnAddr((a) => ({ ...a, street2: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-[1fr 1fr 1fr] gap-2">
            <input
              type="text"
              placeholder="City *"
              value={returnAddr.city ?? ""}
              onChange={(e) => setReturnAddr((a) => ({ ...a, city: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="State *"
              value={returnAddr.state ?? ""}
              onChange={(e) => setReturnAddr((a) => ({ ...a, state: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="ZIP *"
              value={returnAddr.zip ?? ""}
              onChange={(e) => setReturnAddr((a) => ({ ...a, zip: e.target.value }))}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveReturnAddress}
            disabled={returnAddrSaving}
            className="btn mt-1"
          >
            {returnAddrSaving ? "Saving…" : "Save return address"}
          </button>
          {returnAddrSuccess && <p className="text-green-700 text-sm">Return address saved.</p>}
        </div>
      </div>

      {error && (
        <div className="border rounded-lg p-4 bg-red-50 border-red-200 mb-6 w-full max-md:text-center">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="border rounded-lg p-4 bg-green-50 border-green-200 mb-6 w-full max-md:text-center">
          <p className="text-green-800 font-medium">EasyPost account connected.</p>
          <p className="text-green-700 text-sm mt-1">
            You can now get rates and buy labels from the{" "}
            <Link href="/seller-hub/ship" className="underline hover:no-underline">
              Ship Items
            </Link>{" "}
            page. Labels will be charged to your EasyPost account and are printable from this site.
          </p>
        </div>
      )}

      <p className="text-sm text-gray-500 max-md:text-center">
        You can return to this page anytime to update your API key. Labels you purchase will open in
        a new tab so you can print them.
      </p>
      </div>
    </section>
  );
}
