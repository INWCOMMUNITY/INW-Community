"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function SetUpShippoPageInner() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!searchParams) return;
    if (searchParams.get("nwAutoOAuth") === "1" && typeof window !== "undefined") {
      window.location.replace("/api/shipping/oauth-start");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!searchParams) return;
    const oauthError = searchParams.get("oauth_error");
    if (oauthError) setError(decodeURIComponent(oauthError));
    if (searchParams.get("connected") === "shippo") {
      setSuccess(true);
      setConnected(true);
      setError(null);
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams?.get("connected") === "shippo") return;
    fetch("/api/shipping/status", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json().catch(() => ({}))) as { connected?: boolean };
        if (typeof data.connected === "boolean") setConnected(data.connected);
      })
      .catch(() => {});
  }, [searchParams]);

  const showConnected = success || connected === true;

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
          Connect your Shippo account once. Then you’ll purchase and print shipping labels right here on Northwest
          Community. Labels are charged to your Shippo account. Add at least one address to your Shippo{" "}
          <strong>Address Book</strong> (Settings → Addresses) so rates and labels work; you can use your own address.{" "}
          <Link href="/seller-hub/shipping-options" className="underline">
            Manage shipping options
          </Link>
          {" "}for package size and weight.
        </p>

        {showConnected ? (
          <div className="border rounded-lg p-4 bg-green-50 border-green-200 mb-6 w-full max-md:text-center">
            <p className="text-green-800 font-medium">Shippo is connected.</p>
            <p className="text-green-700 text-sm mt-1">
              Select orders and click <strong>Purchase labels</strong> to buy and print on the site. Add at least one
              address to your Shippo Address Book if you haven’t already.
            </p>
            <Link href="/seller-hub/orders?tab=ship" className="btn mt-4 inline-block">
              Go to My Orders
            </Link>
            <p className="text-sm text-gray-500 mt-4">
              Need to use a different Shippo account?{" "}
              <Link href="/api/shipping/oauth-start" className="underline">
                Reconnect with Shippo
              </Link>
            </p>
          </div>
        ) : (
          <div className="border-2 rounded-lg p-6 mb-8 border-[var(--color-primary)] bg-white w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
            <h2 className="font-semibold text-lg mb-2">Connect with Shippo</h2>
            <p className="text-gray-600 mb-4 max-md:text-center">
              {connected === null
                ? "Checking your shipping connection…"
                : "Sign in or create a Shippo account and connect it to Northwest Community in one step."}
            </p>
            {connected === false ? (
              <Link href="/api/shipping/oauth-start" className="btn inline-block">
                Connect with Shippo
              </Link>
            ) : null}
          </div>
        )}

        {error && (
          <div className="border rounded-lg p-4 bg-red-50 border-red-200 mb-6 w-full max-md:text-center">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        <p className="text-sm text-gray-500 max-md:text-center">
          You can return here anytime to update your Shippo connection.
        </p>
      </div>
    </section>
  );
}

export default function SetUpShippoPage() {
  return (
    <Suspense fallback={<p className="p-8 text-gray-500 text-center">Loading…</p>}>
      <SetUpShippoPageInner />
    </Suspense>
  );
}
