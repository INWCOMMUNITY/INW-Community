"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_SYNC_PATH,
  formatCents,
  formatShopifyObservedQuantity,
  shopifyHealthLabel,
  shopifyReadinessLabel,
} from "@/lib/shopify/apps-airport";

type ListingRow = {
  listingLinkId: string;
  storeItemId: string;
  title: string;
  priceCents: number;
  quantity: number;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  remoteProductStatus: string | null;
  inventoryDesiredAvailable: number | null;
  inventoryAppliedAvailable: number | null;
  lastReconciledAt: string | null;
  updatedAt: string;
  issueMessage: string | null;
  importSource?: string | null;
};

export default function AppsAirportShopifyListingsPage() {
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<string>("LOADING");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/shopify/listings${refresh ? "?refresh=1" : ""}`,
        { credentials: "include" }
      );
      if (!response.ok) {
        setError("Could not load synced listings.");
        return;
      }
      const body = (await response.json()) as {
        connectionStatus: string;
        listings: ListingRow[];
      };
      setConnectionStatus(body.connectionStatus);
      setListings(body.listings ?? []);
    } catch {
      setError("Could not load synced listings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <AppsAirportChrome
      title="Synced listings"
      subtitle="Mappings for your current Shopify connection generation only."
      crumbs={[
        { href: APPS_AIRPORT_SHOPIFY_PATH, label: "Shopify" },
        { href: APPS_AIRPORT_SHOPIFY_LISTINGS_PATH, label: "Synced listings" },
      ]}
    >
      <div className="mb-6 flex flex-wrap gap-3">
        <Link href={APPS_AIRPORT_SHOPIFY_SYNC_PATH} className="btn" prefetch={false}>
          Sync a listing
        </Link>
        <button
          type="button"
          className="btn border border-gray-300 bg-white hover:bg-gray-50"
          style={{ color: "var(--color-heading)" }}
          disabled={refreshing || connectionStatus !== "ACTIVE"}
          onClick={() => void load(true)}
        >
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </div>

      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {connectionStatus === "CONNECTION_REQUIRED" ? (
        <div className="rounded-[10px] border-2 p-5" style={{ borderColor: "var(--color-primary)" }}>
          <p className="font-semibold">No active Shopify connection</p>
          <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="btn mt-4 inline-block" prefetch={false}>
            Connection settings
          </Link>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-neutral-600">Loading synced listings…</p> : null}

      {!loading && connectionStatus === "ACTIVE" && listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No synced listings yet.{" "}
          <Link href={APPS_AIRPORT_SHOPIFY_SYNC_PATH} className="underline" prefetch={false}>
            Sync a listing
          </Link>{" "}
          to create your first Shopify draft mapping.
        </p>
      ) : null}

      {!loading && listings.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                <th className="py-2 pr-3 font-semibold">INW listing</th>
                <th className="py-2 pr-3 font-semibold">Shopify status</th>
                <th className="py-2 pr-3 font-semibold">INW price</th>
                <th className="py-2 pr-3 font-semibold">Inventory</th>
                <th className="py-2 pr-3 font-semibold">Content</th>
                <th className="py-2 pr-3 font-semibold">Inv. health</th>
                <th className="py-2 pr-3 font-semibold">Readiness</th>
                <th className="py-2 pr-3 font-semibold">Updated</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((row) => (
                <tr key={row.listingLinkId} className="border-b border-neutral-200 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">{row.title}</div>
                    <div className="text-xs text-neutral-500">
                      {row.importSource === "SHOPIFY_IMPORT"
                        ? "Imported from Shopify"
                        : "Exported from INW"}
                    </div>
                  </td>
                  <td className="py-3 pr-3">{row.remoteProductStatus ?? "—"}</td>
                  <td className="py-3 pr-3">{formatCents(row.priceCents)}</td>
                  <td className="py-3 pr-3">
                    <div>INW: {row.quantity}</div>
                    <div className="text-neutral-600">
                      Shopify:{" "}
                      {formatShopifyObservedQuantity({
                        inventoryAppliedAvailable: row.inventoryAppliedAvailable,
                        inventoryDesiredAvailable: row.inventoryDesiredAvailable,
                      })}
                    </div>
                  </td>
                  <td className="py-3 pr-3">{shopifyHealthLabel(row.contentHealth)}</td>
                  <td className="py-3 pr-3">{shopifyHealthLabel(row.inventoryHealth)}</td>
                  <td className="py-3 pr-3">
                    <div>{shopifyReadinessLabel(row.readiness)}</div>
                    {row.issueMessage ? (
                      <div className="mt-1 text-xs text-amber-800 max-w-[14rem]">{row.issueMessage}</div>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {row.lastReconciledAt
                      ? new Date(row.lastReconciledAt).toLocaleString()
                      : new Date(row.updatedAt).toLocaleString()}
                  </td>
                  <td className="py-3">
                    <Link
                      href={`${APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}/${row.storeItemId}`}
                      className="underline"
                      style={{ color: "var(--color-primary)" }}
                      prefetch={false}
                    >
                      Manage
                    </Link>
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
