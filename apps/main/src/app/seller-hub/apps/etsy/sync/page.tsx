"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_ETSY_LISTINGS_PATH,
  APPS_AIRPORT_ETSY_PATH,
  APPS_AIRPORT_ETSY_SETTINGS_PATH,
  APPS_AIRPORT_ETSY_SYNC_PATH,
} from "@/lib/etsy/apps-airport";

type EligibleListing = {
  storeItemId: string;
  title: string;
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  variantCount?: number;
  howItsMadeReady?: boolean;
  howItsMadeMissing?: string[];
  supported?: boolean;
  unsupportedReason?: string | null;
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AppsAirportEtsySyncPage() {
  const [listings, setListings] = useState<EligibleListing[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("LOADING");
  const [shippingReady, setShippingReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadEligible = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/etsy/listings/eligible", { credentials: "include" });
      if (!response.ok) {
        setError("Could not load eligible listings.");
        return;
      }
      const body = (await response.json()) as {
        connectionStatus: string;
        connection?: { shippingProfileReady?: boolean };
        listings: EligibleListing[];
      };
      setConnectionStatus(body.connectionStatus);
      setShippingReady(Boolean(body.connection?.shippingProfileReady));
      setListings(body.listings ?? []);
    } catch {
      setError("Could not load eligible listings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEligible();
  }, [loadEligible]);

  async function onList(storeItemId: string) {
    setError(null);
    setStatusMessage(null);
    setSyncingId(storeItemId);
    try {
      const response = await fetch("/api/etsy/listings/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId }),
      });
      const body = (await response.json()) as {
        status?: string;
        error?: string;
        code?: string;
        missing?: string[];
      };
      if (!response.ok) {
        setError(body.error ?? "Could not start Etsy listing.");
        return;
      }
      if (body.status === "already_mapped") {
        setStatusMessage("Already listed on Etsy for this connection.");
      } else if (body.status === "queued") {
        setStatusMessage("Queued. The Etsy worker will create the listing shortly.");
      }
      await loadEligible();
    } catch {
      setError("Could not start Etsy listing.");
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <AppsAirportChrome
      title="List on Etsy"
      subtitle="Choose an INW listing with How it’s made completed, then publish it to your Etsy shop."
      crumbs={[
        { href: APPS_AIRPORT_ETSY_PATH, label: "Etsy" },
        { href: APPS_AIRPORT_ETSY_SYNC_PATH, label: "List on Etsy" },
      ]}
    >
      {connectionStatus === "DISCONNECTED" ? (
        <div className="rounded-[10px] border-2 p-5" style={{ borderColor: "var(--color-primary)" }}>
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Connect Etsy first
          </p>
          <Link href={APPS_AIRPORT_ETSY_SETTINGS_PATH} className="btn mt-4 inline-block" prefetch={false}>
            Connection settings
          </Link>
        </div>
      ) : null}

      {connectionStatus === "ACTIVE" && !shippingReady ? (
        <div className="mb-6 rounded-[10px] border-2 border-amber-300 bg-amber-50 p-4 text-sm">
          Choose a default Etsy shipping profile in{" "}
          <Link href={APPS_AIRPORT_ETSY_SETTINGS_PATH} className="underline" prefetch={false}>
            Connection settings
          </Link>{" "}
          before listing.
        </div>
      ) : null}

      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {statusMessage ? (
        <div className="mb-6 rounded-[10px] border-2 p-4" style={{ borderColor: "var(--color-primary)" }}>
          <p className="text-sm text-neutral-700">{statusMessage}</p>
          <Link href={APPS_AIRPORT_ETSY_LISTINGS_PATH} className="btn mt-3 inline-block" prefetch={false}>
            View mapped listings
          </Link>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-neutral-600">Loading eligible listings…</p> : null}

      {!loading && connectionStatus === "ACTIVE" && listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No eligible listings. Active INW items that are not already mapped will appear here.
        </p>
      ) : null}

      {!loading && listings.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                <th className="py-2 pr-4 font-semibold">INW listing</th>
                <th className="py-2 pr-4 font-semibold">Price</th>
                <th className="py-2 pr-4 font-semibold">How it’s made</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => {
                const supported = listing.supported !== false && Boolean(listing.howItsMadeReady);
                return (
                  <tr key={listing.storeItemId} className="border-b border-neutral-200">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/seller-hub/store/${listing.storeItemId}`}
                        className="font-medium underline"
                        style={{ color: "var(--color-primary)" }}
                        prefetch={false}
                      >
                        {listing.title}
                      </Link>
                      {!supported && listing.unsupportedReason ? (
                        <p className="mt-1 text-xs text-amber-800">{listing.unsupportedReason}</p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">{formatCents(listing.priceCents)}</td>
                    <td className="py-3 pr-4">
                      {listing.howItsMadeReady ? (
                        <span className="text-xs uppercase tracking-wide text-neutral-500">Ready</span>
                      ) : (
                        <span className="text-xs text-amber-800">
                          Missing {(listing.howItsMadeMissing ?? []).join(", ") || "fields"}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        className="btn"
                        disabled={
                          !shippingReady || !supported || syncingId === listing.storeItemId
                        }
                        onClick={() => void onList(listing.storeItemId)}
                      >
                        {syncingId === listing.storeItemId ? "Listing…" : "List on Etsy"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppsAirportChrome>
  );
}
