"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { ShopifyListingActionButtons } from "@/components/apps-airport/ShopifyListingActionButtons";
import {
  APPS_AIRPORT_SHOPIFY_IMPORT_PATH,
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_SYNC_PATH,
  classifyShopifyConnectionUi,
  formatCents,
  formatRelativeUpdatedAt,
  formatShopifyObservedQuantity,
  shopifyConnectionStatusChipClass,
  shopifyConnectionStatusLabel,
  shopifyListingStatusChipClass,
  shopifyListingUiStatus,
  shopifyRemountSellerCopy,
  type ShopifyListingUiStatus,
} from "@/lib/shopify/apps-airport";

type PublicConnection = {
  id: string;
  shopDomain: string;
  generation: number;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
  primaryLocationId: string | null;
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
};

type RemountStatus = {
  state: string;
  message: string | null;
  errorCode: string | null;
} | null;

type ListingRow = {
  listingLinkId: string;
  storeItemId: string;
  shopifyProductId: string;
  title: string;
  priceCents: number;
  quantity: number;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  issueCode: string | null;
  issueMessage: string | null;
  inventoryDesiredAvailable: number | null;
  inventoryAppliedAvailable: number | null;
  updatedAt: string;
};

type FilterTab = "all" | ShopifyListingUiStatus;

export default function AppsAirportShopifyPage() {
  const [connection, setConnection] = useState<PublicConnection | null>(null);
  const [remount, setRemount] = useState<RemountStatus>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [connRes, listRes] = await Promise.all([
        fetch("/api/shopify/connection", { credentials: "include" }),
        fetch("/api/shopify/listings", { credentials: "include" }),
      ]);
      if (!connRes.ok) {
        setError("Could not load Shopify connection.");
        return;
      }
      const connBody = (await connRes.json()) as {
        connections: PublicConnection[];
        remount?: RemountStatus;
      };
      const active = connBody.connections.find((c) => c.status === "ACTIVE") ?? null;
      setConnection(active);
      setRemount(connBody.remount ?? null);
      if (listRes.ok) {
        const listBody = (await listRes.json()) as {
          shopDomain?: string | null;
          listings: ListingRow[];
        };
        setShopDomain(listBody.shopDomain ?? active?.shopDomain ?? null);
        setListings(listBody.listings ?? []);
      }
    } catch {
      setError("Could not load Shopify management.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const uiStatus = classifyShopifyConnectionUi(connection);
  const remountCopy = shopifyRemountSellerCopy(remount);

  const rowsWithStatus = useMemo(
    () =>
      listings.map((row) => ({
        row,
        status: shopifyListingUiStatus({
          readiness: row.readiness,
          contentHealth: row.contentHealth,
          inventoryHealth: row.inventoryHealth,
          issueCode: row.issueCode,
        }),
      })),
    [listings]
  );

  const counts = useMemo(() => {
    const base = {
      all: rowsWithStatus.length,
      Live: 0,
      Unpublished: 0,
      "Needs attention": 0,
      Syncing: 0,
    };
    for (const item of rowsWithStatus) base[item.status] += 1;
    return base;
  }, [rowsWithStatus]);

  const filtered = useMemo(() => {
    if (filter === "all") return rowsWithStatus;
    return rowsWithStatus.filter((item) => item.status === filter);
  }, [rowsWithStatus, filter]);

  const tabs: Array<{ id: FilterTab; label: string }> = [
    { id: "all", label: `All (${counts.all})` },
    { id: "Live", label: `Live (${counts.Live})` },
    { id: "Needs attention", label: `Needs attention (${counts["Needs attention"]})` },
    { id: "Unpublished", label: `Unpublished (${counts.Unpublished})` },
    { id: "Syncing", label: `Syncing (${counts.Syncing})` },
  ];

  return (
    <AppsAirportChrome
      title="Shopify"
      subtitle="Your INW listings on Shopify Online Store — Live means published and sellable."
      crumbs={[{ href: "/seller-hub/apps/shopify", label: "Shopify" }]}
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {toast ? (
        <p
          className="mb-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          role="status"
        >
          {toast}
        </p>
      ) : null}

      <div
        className="rounded-[10px] border-2 p-5 mb-6"
        style={{ borderColor: "var(--color-primary)" }}
      >
        {loading ? (
          <p className="text-sm text-neutral-600">Loading Shopify status…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${shopifyConnectionStatusChipClass(uiStatus)}`}
              >
                {shopifyConnectionStatusLabel(uiStatus)}
              </span>
              {connection ? (
                <span className="text-sm font-medium" style={{ color: "var(--color-heading)" }}>
                  {connection.shopDomain}
                </span>
              ) : null}
            </div>
            {connection ? (
              <div className="mt-2 grid gap-1 text-sm text-neutral-700">
                <p>
                  Primary location:{" "}
                  {connection.primaryLocationId ? "Selected" : "Needs selection"}
                </p>
                {remountCopy.tone !== "idle" && remountCopy.title ? (
                  <p
                    className={
                      remountCopy.tone === "error"
                        ? "text-red-800"
                        : remountCopy.tone === "progress"
                          ? "text-amber-800"
                          : "text-neutral-600"
                    }
                  >
                    {remountCopy.title}
                    {remountCopy.detail ? (
                      <span className="block text-xs mt-0.5 text-neutral-600">
                        {remountCopy.detail}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-neutral-600">
                Connect Shopify to list INW items on your Online Store.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              {uiStatus === "disconnected" ? (
                <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="btn" prefetch={false}>
                  Connect Shopify
                </Link>
              ) : null}
              {uiStatus === "needs_attention" ? (
                <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="btn" prefetch={false}>
                  Finish connection setup
                </Link>
              ) : null}
              {uiStatus === "connected" ? (
                <Link href={APPS_AIRPORT_SHOPIFY_SYNC_PATH} className="btn" prefetch={false}>
                  List on Shopify
                </Link>
              ) : null}
            </div>
          </>
        )}
      </div>

      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-bold" style={{ color: "var(--color-heading)" }}>
              Synced listings
            </h2>
            <p className="text-sm text-neutral-600">
              {counts.Live} live · {counts["Needs attention"]} need attention · {counts.Unpublished}{" "}
              unpublished
            </p>
          </div>
          <Link
            href={APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}
            className="text-sm underline"
            style={{ color: "var(--color-primary)" }}
            prefetch={false}
          >
            Full inventory table
          </Link>
        </div>

        {!loading && uiStatus === "disconnected" ? (
          <p className="text-sm text-neutral-600">Connect Shopify to see synced listings.</p>
        ) : null}

        {!loading && uiStatus !== "disconnected" && listings.length === 0 ? (
          <div
            className="rounded-[10px] border-2 border-dashed p-6 text-center"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
              List your first item on Shopify
            </p>
            <p className="mt-2 text-sm text-neutral-600 max-w-md mx-auto">
              Export an INW listing. When status is Live, it is ACTIVE on Shopify Online Store with
              inventory initialized — not a draft.
            </p>
            <Link href={APPS_AIRPORT_SHOPIFY_SYNC_PATH} className="btn mt-4 inline-block" prefetch={false}>
              List on Shopify
            </Link>
          </div>
        ) : null}

        {!loading && listings.length > 0 ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    filter === tab.id
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                  }`}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                    <th className="py-2 pr-3 font-semibold">Listing</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Qty</th>
                    <th className="py-2 pr-3 font-semibold">Price</th>
                    <th className="py-2 pr-3 font-semibold">Updated</th>
                    <th className="py-2 font-semibold">Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 20).map(({ row, status }) => (
                    <tr key={row.listingLinkId} className="border-b border-neutral-200 align-middle">
                      <td className="py-3 pr-3">
                        <Link
                          href={`${APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}/${row.storeItemId}`}
                          className="font-medium underline"
                          style={{ color: "var(--color-primary)" }}
                          prefetch={false}
                        >
                          {row.title}
                        </Link>
                        {row.issueMessage && status !== "Live" ? (
                          <div className="mt-1 text-xs text-amber-800 max-w-[16rem]">
                            {row.issueMessage}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${shopifyListingStatusChipClass(status)}`}
                        >
                          {status}
                        </span>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap">
                        <span title="INW quantity">{row.quantity}</span>
                        <span className="text-neutral-400"> · </span>
                        <span title="Shopify observed">
                          {formatShopifyObservedQuantity({
                            inventoryAppliedAvailable: row.inventoryAppliedAvailable,
                            inventoryDesiredAvailable: row.inventoryDesiredAvailable,
                          })}
                        </span>
                      </td>
                      <td className="py-3 pr-3">{formatCents(row.priceCents)}</td>
                      <td className="py-3 pr-3 text-neutral-600">
                        {formatRelativeUpdatedAt(row.updatedAt)}
                      </td>
                      <td className="py-3">
                        <ShopifyListingActionButtons
                          storeItemId={row.storeItemId}
                          shopDomain={shopDomain}
                          shopifyProductId={row.shopifyProductId}
                          preferStorefront={status === "Live"}
                          onActionComplete={(message) => {
                            if (message) setToast(message);
                            void load();
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-600">No listings in this filter.</p>
            ) : null}
          </>
        ) : null}
      </div>

      <details className="rounded-[10px] border border-neutral-300 bg-[var(--color-section-alt)] p-4">
        <summary
          className="cursor-pointer font-semibold text-sm"
          style={{ color: "var(--color-heading)" }}
        >
          Advanced
        </summary>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href={APPS_AIRPORT_SHOPIFY_IMPORT_PATH}
            className="rounded-[10px] border-2 p-4 bg-white hover:bg-[var(--color-section-alt)] transition"
            style={{ borderColor: "var(--color-primary)" }}
            prefetch={false}
          >
            <h3 className="font-bold" style={{ color: "var(--color-heading)" }}>
              Import listings
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              Bring unmapped Shopify products into INW when supported.
            </p>
          </Link>
          <Link
            href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH}
            className="rounded-[10px] border-2 p-4 bg-white hover:bg-[var(--color-section-alt)] transition"
            style={{ borderColor: "var(--color-primary)" }}
            prefetch={false}
          >
            <h3 className="font-bold" style={{ color: "var(--color-heading)" }}>
              Connection settings
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              Connect, choose location, or disconnect Shopify.
            </p>
          </Link>
        </div>
      </details>
    </AppsAirportChrome>
  );
}
