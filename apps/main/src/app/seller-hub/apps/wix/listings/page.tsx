"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { AppsAirportSyncedListings } from "@/components/apps-airport/AppsAirportSyncedListings";
import { WixListingActionButtons } from "@/components/wix/WixListingActionButtons";
import {
  APPS_AIRPORT_WIX_HUB,
  formatWixCents,
  wixListingStatusChipClass,
  wixListingUiStatus,
  type WixListingUiStatus,
} from "@/lib/wix/apps-airport";

type ListingRow = {
  id: string;
  storeItemId: string;
  wixProductId: string;
  title: string;
  priceCents: number | null;
  quantity: number | null;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  issueCode: string | null;
  issueMessage: string | null;
  storeItemStatus: string | null;
  remoteProductVisible?: boolean | null;
  attentionKind?: "mapped" | "unmapped_create";
};

type FilterTab = "all" | WixListingUiStatus;

export default function AppsAirportWixListingsPage() {
  const hub = APPS_AIRPORT_WIX_HUB;
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/wix/listings", { credentials: "include" });
      if (!response.ok) {
        setError("Could not load Wix listings.");
        return;
      }
      const body = (await response.json()) as { listings: ListingRow[] };
      setListings(body.listings ?? []);
    } catch {
      setError("Could not load Wix listings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rowsWithStatus = useMemo(
    () =>
      listings.map((row) => ({
        row,
        status: wixListingUiStatus({
          readiness: row.readiness,
          contentHealth: row.contentHealth,
          inventoryHealth: row.inventoryHealth,
          issueCode: row.issueCode,
          storeItemStatus: row.storeItemStatus,
          remoteProductVisible: row.remoteProductVisible,
        }),
      })),
    [listings]
  );

  const filtered =
    filter === "all" ? rowsWithStatus : rowsWithStatus.filter((r) => r.status === filter);

  const tabs = [
    { id: "all", label: `All (${rowsWithStatus.length})` },
    { id: "Live", label: "Live" },
    { id: "Needs attention", label: "Needs attention" },
    { id: "Unpublished", label: "Unpublished" },
    { id: "Syncing", label: "Syncing" },
  ];

  return (
    <AppsAirportChrome
      title="Wix Linked Listings"
      subtitle="All INW listings mapped to your Wix store."
      crumbs={[
        { href: hub.hubPath, label: hub.displayName },
        { href: hub.listingsPath, label: "Listings" },
      ]}
    >
      <div className="mb-4 flex flex-wrap gap-3">
        <Link href={hub.importPath} className="btn" prefetch={false}>
          {hub.importLabel}
        </Link>
        <Link href={hub.listItemsPath} className="btn" prefetch={false}>
          {hub.listItemsLabel}
        </Link>
        <Link href={hub.settingsPath} className="btn" prefetch={false}>
          {hub.settingsLabel}
        </Link>
      </div>
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {toast ? (
        <p className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {toast}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-neutral-600">Loading listings…</p>
      ) : listings.length === 0 ? (
        <p className="text-sm text-neutral-600">No linked Wix listings yet.</p>
      ) : (
        <AppsAirportSyncedListings
          summary={`${listings.length} listing${listings.length === 1 ? "" : "s"}`}
          filterTabs={tabs}
          activeFilterId={filter}
          onFilterChange={(id) => setFilter(id as FilterTab)}
          tableHead={
            <>
              <th className="py-2 pr-3 font-semibold">Listing</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">Qty</th>
              <th className="py-2 pr-3 font-semibold">Price</th>
              <th className="py-2 font-semibold">Manage</th>
            </>
          }
        >
          {filtered.map(({ row, status }) => (
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
                {row.issueMessage ? (
                  <div className="mt-1 text-xs text-amber-800 max-w-[16rem]">{row.issueMessage}</div>
                ) : null}
              </td>
              <td className="py-3 pr-3">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${wixListingStatusChipClass(status)}`}
                >
                  {status}
                </span>
              </td>
              <td className="py-3 pr-3">{row.quantity ?? "—"}</td>
              <td className="py-3 pr-3">{formatWixCents(row.priceCents)}</td>
              <td className="py-3">
                <WixListingActionButtons
                  storeItemId={row.storeItemId}
                  listingLinkId={row.attentionKind === "unmapped_create" ? null : row.id}
                  wixProductId={row.wixProductId || null}
                  remoteProductVisible={row.remoteProductVisible}
                  onActionComplete={(message) => {
                    setToast(message ?? "Updated");
                    void load();
                  }}
                />
              </td>
            </tr>
          ))}
        </AppsAirportSyncedListings>
      )}
    </AppsAirportChrome>
  );
}
