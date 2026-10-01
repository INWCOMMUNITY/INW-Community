"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppsAirportChannelHub } from "@/components/apps-airport/AppsAirportChannelHub";
import { AppsAirportSyncedListings } from "@/components/apps-airport/AppsAirportSyncedListings";
import {
  APPS_AIRPORT_ETSY_HUB,
  appsAirportEtsyHubTitle,
  classifyEtsyConnectionUi,
  etsyConnectionStatusLabel,
  etsyListingStatusChipClass,
  etsyListingUiStatus,
  formatEtsyCents,
  type EtsyListingUiStatus,
} from "@/lib/etsy/apps-airport";

type PublicConnection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
};

type ListingRow = {
  id: string;
  storeItemId: string;
  etsyListingId: string;
  title: string;
  priceCents: number | null;
  quantity: number | null;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  issueCode: string | null;
  issueMessage: string | null;
  storeItemStatus: string | null;
};

type FilterTab = "all" | EtsyListingUiStatus;

export default function AppsAirportEtsyPage() {
  const [connection, setConnection] = useState<PublicConnection | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const hub = APPS_AIRPORT_ETSY_HUB;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [connRes, listRes] = await Promise.all([
        fetch("/api/etsy/connection", { credentials: "include" }),
        fetch("/api/etsy/listings", { credentials: "include" }),
      ]);
      if (!connRes.ok) {
        setError("Could not load Etsy connection.");
        return;
      }
      const body = (await connRes.json()) as { connections: PublicConnection[] };
      setConnection(body.connections.find((c) => c.status === "ACTIVE") ?? null);
      if (listRes.ok) {
        const listingsBody = (await listRes.json()) as { listings: ListingRow[] };
        setListings(listingsBody.listings ?? []);
      }
    } catch {
      setError("Could not load Etsy connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const imported = params.get("imported");
    if (imported) {
      setToast("Imported listing from Etsy.");
      window.history.replaceState({}, "", hub.hubPath);
    }
  }, [hub.hubPath]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const uiStatus = classifyEtsyConnectionUi(connection);
  const statusLabel = etsyConnectionStatusLabel(uiStatus);
  const connected = uiStatus === "connected";

  const rowsWithStatus = useMemo(
    () =>
      listings.map((row) => ({
        row,
        status: etsyListingUiStatus({
          readiness: row.readiness,
          contentHealth: row.contentHealth,
          inventoryHealth: row.inventoryHealth,
          issueCode: row.issueCode,
          storeItemStatus: row.storeItemStatus,
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

  return (
    <AppsAirportChannelHub
      title={appsAirportEtsyHubTitle(hub.displayName, statusLabel)}
      subtitle="INW listings linked to Etsy, plus any List on Etsy attempts that still need attention."
      crumbs={[{ href: hub.hubPath, label: hub.displayName }]}
      statusDetail={
        !loading && connected ? (
          <p>
            Connected to {connection?.shopName ?? `Shop #${connection?.shopId}`}.
            {listings.length > 0
              ? ` ${listings.length} linked listing${listings.length === 1 ? "" : "s"}.`
              : null}
          </p>
        ) : null
      }
      actions={[
        {
          label: hub.importLabel,
          href: hub.importPath,
          disabled: !connected,
        },
        {
          label: hub.listItemsLabel,
          href: hub.listItemsPath,
          disabled: !connected,
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
          Connect Etsy to see mapped listings and enable Import / List items.{" "}
          <Link
            href={hub.settingsPath}
            className="underline"
            style={{ color: "var(--color-primary)" }}
            prefetch={false}
          >
            Connection Settings
          </Link>
        </p>
      ) : null}

      {!loading && connected && listings.length === 0 ? (
        <div
          className="rounded-[10px] border-2 border-dashed p-6 text-center mb-6"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            List your first item on Etsy
          </p>
          <p className="mt-2 text-sm text-neutral-600 max-w-md mx-auto">
            Import from your Etsy shop, or publish an INW listing with How it&apos;s made completed.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href={hub.importPath} className="btn inline-block" prefetch={false}>
              {hub.importLabel}
            </Link>
            <Link href={hub.listItemsPath} className="btn inline-block" prefetch={false}>
              {hub.listItemsLabel}
            </Link>
          </div>
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
              <th className="py-2 font-semibold">Etsy</th>
            </>
          }
        >
          {filtered.slice(0, 20).map(({ row, status }) => (
            <tr key={row.id} className="border-b border-neutral-200 align-top">
              <td className="py-3 pr-3">
                <Link
                  href={`/seller-hub/store/${row.storeItemId}`}
                  className="font-medium underline"
                  style={{ color: "var(--color-primary)" }}
                  prefetch={false}
                >
                  {row.title}
                </Link>
                {status !== "Live" && row.issueMessage ? (
                  <div className="mt-1 text-xs text-amber-800 max-w-[16rem]">{row.issueMessage}</div>
                ) : null}
              </td>
              <td className="py-3 pr-3">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${etsyListingStatusChipClass(status)}`}
                >
                  {status}
                </span>
              </td>
              <td className="py-3 pr-3 whitespace-nowrap">{row.quantity ?? "—"}</td>
              <td className="py-3 pr-3">{formatEtsyCents(row.priceCents)}</td>
              <td className="py-3">
                {row.etsyListingId ? (
                  <a
                    href={`https://www.etsy.com/listing/${row.etsyListingId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline"
                    style={{ color: "var(--color-primary)" }}
                  >
                    View on Etsy
                  </a>
                ) : (
                  <Link
                    href={hub.listItemsPath}
                    className="text-xs underline"
                    style={{ color: "var(--color-primary)" }}
                    prefetch={false}
                  >
                    Retry list
                  </Link>
                )}
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
