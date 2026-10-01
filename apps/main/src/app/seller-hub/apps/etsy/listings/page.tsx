"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppsAirportChannelHub } from "@/components/apps-airport/AppsAirportChannelHub";
import { APPS_AIRPORT_ETSY_HUB } from "@/lib/etsy/apps-airport";

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
};

export default function AppsAirportEtsyListingsPage() {
  const hub = APPS_AIRPORT_ETSY_HUB;
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shopName, setShopName] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/etsy/listings", { credentials: "include" })
      .then(async (response) => {
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
      })
      .catch(() => setError("Could not load Etsy listings."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppsAirportChannelHub
      title="Etsy mapped listings"
      subtitle="Readiness from the latest reconcile. Import more from Etsy anytime."
      crumbs={[
        { href: hub.hubPath, label: hub.displayName },
        { href: hub.listingsPath, label: "Listings" },
      ]}
      actions={[
        { label: hub.importLabel, href: hub.importPath },
        { label: hub.settingsLabel, href: hub.settingsPath },
      ]}
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
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
          No mapped listings yet.{" "}
          <Link href={hub.importPath} className="underline" style={{ color: "var(--color-primary)" }} prefetch={false}>
            Import from Etsy
          </Link>
        </p>
      ) : null}
      {!loading && listings.length > 0 ? (
        <ul className="space-y-3">
          {listings.map((row) => (
            <li key={row.id} className="border-b border-neutral-200 pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/seller-hub/listings/${row.storeItemId}`}
                  className="text-sm font-medium underline"
                  style={{ color: "var(--color-primary)" }}
                  prefetch={false}
                >
                  {row.title}
                </Link>
                <span className="text-xs uppercase tracking-wide text-neutral-500">{row.readiness}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Etsy #{row.etsyListingId} · content {row.contentHealth} · inventory {row.inventoryHealth}
              </p>
              {row.issueMessage ? (
                <p className="mt-1 text-xs text-amber-800">{row.issueMessage}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </AppsAirportChannelHub>
  );
}
