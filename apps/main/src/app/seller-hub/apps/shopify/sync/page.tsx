"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  formatCents,
  resolveShopifySyncProgress,
  shopifySyncProgressLabel,
  type ShopifySyncProgressStep,
} from "@/lib/shopify/apps-airport";

type EligibleListing = {
  storeItemId: string;
  title: string;
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  status: string;
};

type ListingStatus = {
  storeItemId: string;
  readiness: string;
  inventoryInitState: string | null;
  remoteProductStatus?: string | null;
  issueMessage: string | null;
};

export default function AppsAirportShopifySyncPage() {
  const [listings, setListings] = useState<EligibleListing[]>([]);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>("LOADING");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ShopifySyncProgressStep | null>(null);
  const [progressDetail, setProgressDetail] = useState<string | null>(null);

  const loadEligible = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/shopify/listings/eligible", { credentials: "include" });
      if (!response.ok) {
        setError("Could not load eligible listings.");
        return;
      }
      const body = (await response.json()) as {
        connectionStatus: string;
        inventoryReady?: boolean;
        listings: EligibleListing[];
      };
      setConnectionStatus(body.connectionStatus);
      setInventoryReady(Boolean(body.inventoryReady));
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

  async function pollListingStatus(storeItemId: string, enqueueStatus: "queued" | "already_mapped") {
    setProgress(
      resolveShopifySyncProgress({
        enqueueStatus,
        listing: null,
      })
    );
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 800 : 2000));
      const response = await fetch(
        `/api/shopify/listings?storeItemId=${encodeURIComponent(storeItemId)}`,
        { credentials: "include" }
      );
      if (!response.ok) continue;
      const body = (await response.json()) as { listings: ListingStatus[] };
      const listing = body.listings.find((row) => row.storeItemId === storeItemId) ?? null;
      const step = resolveShopifySyncProgress({ enqueueStatus, listing });
      setProgress(step);
      if (listing?.issueMessage) setProgressDetail(listing.issueMessage);
      if (
        step === "published" ||
        step === "needs_attention" ||
        (enqueueStatus === "already_mapped" && listing)
      ) {
        return;
      }
    }
    setProgressDetail("Sync is still running in the background. Check Synced Listings shortly.");
  }

  async function onSync(storeItemId: string) {
    setError(null);
    setProgressDetail(null);
    setSyncingId(storeItemId);
    setProgress("preparing");
    try {
      const response = await fetch("/api/shopify/listings/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId }),
      });
      const body = (await response.json()) as {
        status?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Could not start Shopify sync.");
        setProgress("needs_attention");
        return;
      }
      if (body.status === "already_mapped") {
        setProgress("already_mapped");
        await pollListingStatus(storeItemId, "already_mapped");
        await loadEligible();
        return;
      }
      if (body.status === "queued") {
        setProgress("queued");
        await pollListingStatus(storeItemId, "queued");
        await loadEligible();
        return;
      }
      setError("Unexpected sync response.");
      setProgress("needs_attention");
    } catch {
      setError("Could not start Shopify sync.");
      setProgress("needs_attention");
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <AppsAirportChrome
      title="Sync a listing"
      subtitle="Choose an active INW listing that is not already mapped, then export it to Shopify as an ACTIVE product published to your Online Store."
      crumbs={[
        { href: APPS_AIRPORT_SHOPIFY_PATH, label: "Shopify" },
        { href: `${APPS_AIRPORT_SHOPIFY_PATH}/sync`, label: "Sync" },
      ]}
    >
      {connectionStatus === "CONNECTION_REQUIRED" ? (
        <div className="rounded-[10px] border-2 p-5" style={{ borderColor: "var(--color-primary)" }}>
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Connect Shopify first
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            You need an active Shopify connection before syncing listings.
          </p>
          <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="btn mt-4 inline-block" prefetch={false}>
            Connection settings
          </Link>
        </div>
      ) : null}

      {connectionStatus === "ACTIVE" && !inventoryReady ? (
        <div className="mb-6 rounded-[10px] border-2 border-amber-300 bg-amber-50 p-4 text-sm">
          Choose a primary Shopify location in{" "}
          <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="underline" prefetch={false}>
            Connection settings
          </Link>{" "}
          before syncing.
        </div>
      ) : null}

      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {progress ? (
        <div
          className="mb-6 rounded-[10px] border-2 p-4"
          style={{ borderColor: "var(--color-primary)" }}
          data-testid="shopify-sync-progress"
        >
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Sync status: {shopifySyncProgressLabel(progress)}
          </p>
          {progressDetail ? <p className="mt-1 text-sm text-neutral-600">{progressDetail}</p> : null}
          {(progress === "published" ||
            progress === "needs_attention" ||
            progress === "already_mapped") && (
            <Link
              href={APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}
              className="btn mt-3 inline-block"
              prefetch={false}
            >
              View synced listings
            </Link>
          )}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-neutral-600">Loading eligible listings…</p> : null}

      {!loading && connectionStatus === "ACTIVE" && listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No eligible listings right now. Sync supports active simple listings with exactly one
          variant that are not already mapped to this Shopify connection.
        </p>
      ) : null}

      {!loading && listings.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                <th className="py-2 pr-4 font-semibold">INW listing</th>
                <th className="py-2 pr-4 font-semibold">Price</th>
                <th className="py-2 pr-4 font-semibold">Inventory</th>
                <th className="py-2 pr-4 font-semibold">SKU</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
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
                  </td>
                  <td className="py-3 pr-4">{formatCents(listing.priceCents)}</td>
                  <td className="py-3 pr-4">{listing.quantity}</td>
                  <td className="py-3 pr-4">{listing.sku ?? "—"}</td>
                  <td className="py-3">
                    <button
                      type="button"
                      className="btn"
                      disabled={!inventoryReady || syncingId === listing.storeItemId}
                      onClick={() => void onSync(listing.storeItemId)}
                    >
                      {syncingId === listing.storeItemId ? "Syncing…" : "Sync to Shopify"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppsAirportChrome>
  );
}
