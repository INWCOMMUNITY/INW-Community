"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppsAirportChannelHub } from "@/components/apps-airport/AppsAirportChannelHub";
import { AppsAirportSyncedListings } from "@/components/apps-airport/AppsAirportSyncedListings";
import { ShopifyListingActionButtons } from "@/components/apps-airport/ShopifyListingActionButtons";
import {
  APPS_AIRPORT_SHOPIFY_HUB,
  appsAirportChannelHubTitle,
  classifyShopifyConnectionUi,
  formatCents,
  formatShopifyObservedQuantity,
  formatSyncedWithChannels,
  shopifyConnectionStatusLabel,
  shopifyListingStatusChipClass,
  shopifyListingIssueSellerDetail,
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

  const hub = APPS_AIRPORT_SHOPIFY_HUB;

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
  const statusLabel = shopifyConnectionStatusLabel(uiStatus);
  const remountCopy = shopifyRemountSellerCopy(remount);
  const connected = uiStatus === "connected";
  const canList = connected;
  const canImport = uiStatus !== "disconnected";

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

  const tabs = [
    { id: "all", label: `All (${counts.all})` },
    { id: "Live", label: `Live (${counts.Live})` },
    { id: "Needs attention", label: `Needs attention (${counts["Needs attention"]})` },
    { id: "Unpublished", label: `Unpublished (${counts.Unpublished})` },
    { id: "Syncing", label: `Syncing (${counts.Syncing})` },
  ];

  const syncedWith = formatSyncedWithChannels(["inw", "shopify"]);

  const statusDetail =
    !loading && remountCopy.tone !== "idle" && remountCopy.title ? (
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
          <span className="block text-xs mt-0.5 text-neutral-600">{remountCopy.detail}</span>
        ) : null}
      </p>
    ) : null;

  return (
    <AppsAirportChannelHub
      title={appsAirportChannelHubTitle(hub.displayName, statusLabel)}
      subtitle="Your INW listings on Shopify Online Store — Live means published and sellable."
      crumbs={[{ href: hub.hubPath, label: hub.displayName }]}
      statusDetail={statusDetail}
      actions={[
        {
          label: hub.importLabel,
          href: hub.importPath,
          disabled: !canImport,
        },
        {
          label: hub.listItemsLabel,
          href: hub.listItemsPath,
          disabled: !canList,
        },
        {
          label: hub.settingsLabel,
          href: hub.settingsPath,
        },
      ]}
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

      {!loading && uiStatus === "disconnected" ? (
        <p className="mb-6 text-sm text-neutral-600">
          Connect Shopify to see synced listings and enable Import / List items.
        </p>
      ) : null}

      {!loading && uiStatus !== "disconnected" && listings.length === 0 ? (
        <div
          className="rounded-[10px] border-2 border-dashed p-6 text-center mb-6"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            List your first item on Shopify
          </p>
          <p className="mt-2 text-sm text-neutral-600 max-w-md mx-auto">
            Export an INW listing. When status is Live, it is ACTIVE on Shopify Online Store with
            inventory initialized — not a draft.
          </p>
          {canList ? (
            <Link href={hub.listItemsPath} className="btn mt-4 inline-block" prefetch={false}>
              {hub.listItemsLabel}
            </Link>
          ) : null}
        </div>
      ) : null}

      {!loading && listings.length > 0 ? (
        <AppsAirportSyncedListings
          summary={
            <>
              {counts.Live} live · {counts["Needs attention"]} need attention · {counts.Unpublished}{" "}
              unpublished
            </>
          }
          filterTabs={tabs}
          activeFilterId={filter}
          onFilterChange={(id) => setFilter(id as FilterTab)}
          tableHead={
            <>
              <th className="py-2 pr-3 font-semibold">Listing</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">Qty</th>
              <th className="py-2 pr-3 font-semibold">Price</th>
              <th className="py-2 pr-3 font-semibold">Synced with</th>
              <th className="py-2 font-semibold">Manage</th>
            </>
          }
        >
          {filtered.slice(0, 20).map(({ row, status }) => (
            <tr key={row.listingLinkId} className="border-b border-neutral-200 align-top">
              <td className="py-3 pr-3">
                <Link
                  href={`${hub.listingsPath}/${row.storeItemId}`}
                  className="font-medium underline"
                  style={{ color: "var(--color-primary)" }}
                  prefetch={false}
                >
                  {row.title}
                </Link>
                {status !== "Live"
                  ? (() => {
                      const detail = shopifyListingIssueSellerDetail({
                        issueCode: row.issueCode,
                        issueMessage: row.issueMessage,
                      });
                      return detail ? (
                        <div className="mt-1 text-xs text-amber-800 max-w-[16rem]">{detail}</div>
                      ) : null;
                    })()
                  : null}
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
              <td className="py-3 pr-3 text-neutral-700 whitespace-nowrap">{syncedWith}</td>
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
        </AppsAirportSyncedListings>
      ) : null}

      {!loading && listings.length > 0 && filtered.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-600">No listings in this filter.</p>
      ) : null}
    </AppsAirportChannelHub>
  );
}
