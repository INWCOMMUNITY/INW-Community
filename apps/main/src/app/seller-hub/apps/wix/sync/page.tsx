"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_WIX_LISTINGS_PATH,
  APPS_AIRPORT_WIX_PATH,
  APPS_AIRPORT_WIX_SETTINGS_PATH,
  APPS_AIRPORT_WIX_SYNC_PATH,
  formatWixCents,
  resolveWixSyncProgress,
  wixSyncProgressLabel,
  type WixSyncProgressStep,
} from "@/lib/wix/apps-airport";

type EligibleListing = {
  storeItemId: string;
  title: string;
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  variantCount?: number;
  photoCount?: number;
  photosReady?: boolean;
  supported?: boolean;
  unsupportedReason?: string | null;
};

export default function AppsAirportWixSyncPage() {
  const [listings, setListings] = useState<EligibleListing[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("LOADING");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<WixSyncProgressStep | null>(null);
  const [progressDetail, setProgressDetail] = useState<string | null>(null);

  const loadEligible = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/wix/listings/eligible", { credentials: "include" });
      if (!response.ok) {
        setError("Could not load eligible listings.");
        return;
      }
      const body = (await response.json()) as {
        connectionStatus: string;
        listings: EligibleListing[];
      };
      setConnectionStatus(body.connectionStatus);
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

  async function pollListing(storeItemId: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 800 : 2000));
      const response = await fetch(
        `/api/wix/listing?storeItemId=${encodeURIComponent(storeItemId)}`,
        { credentials: "include" }
      );
      if (!response.ok) continue;
      const body = (await response.json()) as {
        linked?: boolean;
        link?: {
          readiness?: string | null;
          issueMessage?: string | null;
          remoteProductVisible?: boolean | null;
        };
      };
      if (!body.linked || !body.link) {
        setProgress("queued");
        continue;
      }
      const step = resolveWixSyncProgress({
        enqueueStatus: "queued",
        listing: {
          readiness: body.link.readiness,
          remoteProductVisible: body.link.remoteProductVisible,
          issueMessage: body.link.issueMessage,
        },
      });
      setProgress(step);
      if (body.link.issueMessage) setProgressDetail(body.link.issueMessage);
      if (step === "live" || step === "needs_attention" || step === "already_mapped") {
        return;
      }
    }
    setProgressDetail(
      "Still working in the background. Open Linked Listings in a minute to confirm."
    );
  }

  async function onList(listing: EligibleListing) {
    if (!listing.supported) {
      setError(listing.unsupportedReason ?? "This listing cannot be published to Wix yet.");
      return;
    }
    setError(null);
    setProgressDetail(null);
    setProgress("preparing");
    setSyncingId(listing.storeItemId);
    try {
      setProgress("queued");
      const response = await fetch("/api/wix/listing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId: listing.storeItemId }),
      });
      const body = (await response.json()) as {
        error?: string;
        enqueued?: boolean;
        listingLinkId?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Could not start Wix listing.");
        setProgress("needs_attention");
        return;
      }
      setProgress("creating");
      await pollListing(listing.storeItemId);
      await loadEligible();
    } catch {
      setError("Could not start Wix listing.");
      setProgress("needs_attention");
    } finally {
      setSyncingId(null);
    }
  }

  const connected = connectionStatus === "ACTIVE";

  return (
    <AppsAirportChrome
      title="List Items on Wix"
      subtitle="Publish INW listings to your connected Wix store."
      crumbs={[
        { href: APPS_AIRPORT_WIX_PATH, label: "Wix" },
        { href: APPS_AIRPORT_WIX_SYNC_PATH, label: "List Items" },
      ]}
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {!connected && !loading ? (
        <p className="mb-4 text-sm text-amber-800">
          Connect Wix before listing items.{" "}
          <Link
            href={APPS_AIRPORT_WIX_SETTINGS_PATH}
            className="underline"
            style={{ color: "var(--color-primary)" }}
            prefetch={false}
          >
            Connection Settings
          </Link>
        </p>
      ) : null}
      {progress ? (
        <p className="mb-4 text-sm text-neutral-700">
          {wixSyncProgressLabel(progress)}
          {progressDetail ? ` — ${progressDetail}` : null}{" "}
          <Link
            href={APPS_AIRPORT_WIX_LISTINGS_PATH}
            className="underline"
            style={{ color: "var(--color-primary)" }}
            prefetch={false}
          >
            Linked listings
          </Link>
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-600">Loading eligible listings…</p>
      ) : listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No INW listings are ready to publish to Wix right now.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                <th className="py-2 pr-3 font-semibold">Listing</th>
                <th className="py-2 pr-3 font-semibold">Price</th>
                <th className="py-2 pr-3 font-semibold">Qty</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.storeItemId} className="border-b border-neutral-200 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{listing.title}</div>
                    {!listing.supported && listing.unsupportedReason ? (
                      <div className="mt-1 text-xs text-amber-800">{listing.unsupportedReason}</div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">{formatWixCents(listing.priceCents)}</td>
                  <td className="py-3 pr-3">{listing.quantity}</td>
                  <td className="py-3">
                    <button
                      type="button"
                      className="btn text-sm py-1.5 px-3 disabled:opacity-50"
                      disabled={
                        !connected ||
                        !listing.supported ||
                        syncingId === listing.storeItemId
                      }
                      onClick={() => void onList(listing)}
                    >
                      {syncingId === listing.storeItemId ? "Listing…" : "List on Wix"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppsAirportChrome>
  );
}
