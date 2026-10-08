"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppsAirportChannelHub } from "@/components/apps-airport/AppsAirportChannelHub";
import { EtsyListingActionButtons } from "@/components/etsy/EtsyListingActionButtons";
import {
  APPS_AIRPORT_ETSY_HUB,
  etsyListingPublicUrl,
  etsyListingStatusChipClass,
  etsyListingUiStatus,
} from "@/lib/etsy/apps-airport";

type ListingRow = {
  id: string;
  storeItemId: string;
  etsyListingId: string;
  title: string;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  issueCode: string | null;
  issueMessage: string | null;
  storeItemStatus?: string | null;
  remoteListingState?: string | null;
};

export default function AppsAirportEtsyListingsPage() {
  const hub = APPS_AIRPORT_ETSY_HUB;
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopName, setShopName] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/etsy/listings", { credentials: "include" });
      if (!response.ok) {
        setError("Could not load Etsy listings.");
        return;
      }
      const body = (await response.json()) as {
        connection: {
          shopName: string | null;
          listingContentLastPolledAt: string | null;
        } | null;
        listings: ListingRow[];
      };
      setShopName(body.connection?.shopName ?? null);
      setLastPolledAt(body.connection?.listingContentLastPolledAt ?? null);
      setListings(body.listings);
    } catch {
      setError("Could not load Etsy listings.");
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

  return (
    <AppsAirportChannelHub
      title="Etsy linked listings"
      subtitle="These are INW listings linked to an Etsy listing (imported or published from INW). Live means ready on Etsy."
      crumbs={[
        { href: hub.hubPath, label: hub.displayName },
        { href: hub.listingsPath, label: "Listings" },
      ]}
      actions={[
        { label: hub.importLabel, href: hub.importPath },
        { label: hub.listItemsLabel, href: hub.listItemsPath },
        {
          label: hub.openDashboardLabel,
          href: hub.dashboardUrl,
          external: true,
        },
      ]}
      settingsHref={hub.settingsPath}
      settingsLabel="Settings"
    >
      {error ? <p className="mb-4 text-sm text-neutral-800">{error}</p> : null}
      {toast ? (
        <p
          className="mb-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          role="status"
        >
          {toast}
        </p>
      ) : null}
      {!loading && shopName ? (
        <p className="mb-4 text-sm text-neutral-600">
          Shop: {shopName}
          {lastPolledAt
            ? ` · Last content poll ${new Date(lastPolledAt).toLocaleString()}`
            : " · Content poll pending"}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-neutral-500">Loading…</p> : null}
      {!loading && listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No linked listings yet.{" "}
          <Link href={hub.importPath} className="underline" style={{ color: "var(--color-primary)" }} prefetch={false}>
            Import from Etsy
          </Link>{" "}
          or{" "}
          <Link href={hub.listItemsPath} className="underline" style={{ color: "var(--color-primary)" }} prefetch={false}>
            List Items on Etsy
          </Link>
          .
        </p>
      ) : null}
      {!loading && listings.length > 0 ? (
        <ul className="space-y-3">
          {listings.map((row) => {
            const status = etsyListingUiStatus({
              readiness: row.readiness,
              contentHealth: row.contentHealth,
              inventoryHealth: row.inventoryHealth,
              issueCode: row.issueCode,
              storeItemStatus: row.storeItemStatus,
              remoteListingState: row.remoteListingState,
            });
            return (
              <li key={row.id} className="border-b border-neutral-200 pb-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/seller-hub/store/${row.storeItemId}`}
                    className="text-sm font-medium underline"
                    style={{ color: "var(--color-primary)" }}
                    prefetch={false}
                  >
                    {row.title}
                  </Link>
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${etsyListingStatusChipClass(status)}`}
                  >
                    {status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Etsy #{row.etsyListingId} · content {row.contentHealth} · inventory{" "}
                  {row.inventoryHealth}
                  {row.readiness === "ACTION_REQUIRED" ? " · may still be draft on Etsy" : null}
                </p>
                {row.issueMessage ? (
                  <p className="mt-1 text-xs text-amber-800">{row.issueMessage}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {(() => {
                    const publicUrl = etsyListingPublicUrl({
                      etsyListingId: row.etsyListingId,
                      remoteListingState: row.remoteListingState,
                    });
                    if (publicUrl) {
                      return (
                        <a
                          href={publicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs underline"
                          style={{ color: "var(--color-primary)" }}
                        >
                          View on Etsy
                        </a>
                      );
                    }
                    return <p className="text-xs text-neutral-500">Not live on Etsy yet</p>;
                  })()}
                  {row.etsyListingId ? (
                    <EtsyListingActionButtons
                      storeItemId={row.storeItemId}
                      etsyListingId={row.etsyListingId}
                      remoteListingState={row.remoteListingState}
                      onActionComplete={(message) => {
                        setToast(message ?? "Updated");
                        void load();
                      }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </AppsAirportChannelHub>
  );
}
