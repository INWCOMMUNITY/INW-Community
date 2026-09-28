"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_PATH,
  formatCents,
  shopifyAdminProductUrl,
  shopifyHealthLabel,
  shopifyReadinessLabel,
} from "@/lib/shopify/apps-airport";

type ListingDetail = {
  listingLinkId: string;
  storeItemId: string;
  shopifyProductId: string;
  title: string;
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  storeVariantId: string | null;
  shopifyVariantId: string | null;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  remoteProductStatus: string | null;
  inventoryDesiredAvailable: number | null;
  inventoryAppliedAvailable: number | null;
  inventoryInitState: string | null;
  inventoryDriftState: string | null;
  issueCode: string | null;
  issueSeverity: string | null;
  issueMessage: string | null;
  lastReconciledAt: string | null;
  updatedAt: string;
  blockContentOutbound: boolean;
  blockInventoryOutbound: boolean;
  importSource?: string | null;
  importedAt?: string | null;
};

export default function AppsAirportShopifyListingDetailPage() {
  const params = useParams<{ listingId: string }>();
  const listingId = params?.listingId ?? "";
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (!listingId) return;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ storeItemId: listingId });
        if (refresh) qs.set("refresh", "1");
        const response = await fetch(`/api/shopify/listings?${qs.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) {
          setError("Could not load listing details.");
          return;
        }
        const body = (await response.json()) as {
          connectionStatus: string;
          shopDomain?: string | null;
          listings: ListingDetail[];
        };
        setShopDomain(body.shopDomain ?? null);
        const row = body.listings.find((item) => item.storeItemId === listingId) ?? null;
        setListing(row);
        if (!row) setError("This listing is not synced on your current Shopify connection.");
      } catch {
        setError("Could not load listing details.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [listingId]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const adminUrl = shopifyAdminProductUrl(shopDomain, listing?.shopifyProductId);

  return (
    <AppsAirportChrome
      title={listing?.title ?? "Synced listing"}
      subtitle="INW listing, Shopify mapping, and sync health for the current connection."
      crumbs={[
        { href: APPS_AIRPORT_SHOPIFY_PATH, label: "Shopify" },
        { href: APPS_AIRPORT_SHOPIFY_LISTINGS_PATH, label: "Synced listings" },
        {
          href: `${APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}/${listingId}`,
          label: "Manage",
        },
      ]}
    >
      {loading ? <p className="text-sm text-neutral-600">Loading listing…</p> : null}
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {listing ? (
        <div className="grid gap-6 max-w-3xl">
          <section
            className="rounded-[10px] border-2 p-5"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <h2 className="font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              INW
            </h2>
            {listing.importSource === "SHOPIFY_IMPORT" ? (
              <p className="mb-3 text-sm text-neutral-700">Imported from Shopify</p>
            ) : (
              <p className="mb-3 text-sm text-neutral-700">Exported from INW</p>
            )}
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-neutral-500">Title</dt>
                <dd className="font-medium">{listing.title}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">SKU</dt>
                <dd>{listing.sku ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Price</dt>
                <dd>{formatCents(listing.priceCents)}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Canonical inventory</dt>
                <dd>{listing.quantity}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Variant</dt>
                <dd className="break-all">{listing.storeVariantId ?? "—"}</dd>
              </div>
            </dl>
          </section>

          <section
            className="rounded-[10px] border-2 p-5"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <h2 className="font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Shopify
            </h2>
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-neutral-500">Product</dt>
                <dd className="break-all">{listing.shopifyProductId}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Variant</dt>
                <dd className="break-all">{listing.shopifyVariantId ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Remote status</dt>
                <dd>{listing.remoteProductStatus ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">Readiness</dt>
                <dd>{shopifyReadinessLabel(listing.readiness)}</dd>
              </div>
            </dl>
          </section>

          <section
            className="rounded-[10px] border-2 p-5"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <h2 className="font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Sync health
            </h2>
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="text-neutral-500">Content health</dt>
                <dd>
                  {shopifyHealthLabel(listing.contentHealth)}
                  {listing.blockContentOutbound ? " (outbound paused)" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Inventory health</dt>
                <dd>
                  {shopifyHealthLabel(listing.inventoryHealth)}
                  {listing.blockInventoryOutbound ? " (outbound paused)" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Inventory init / drift</dt>
                <dd>
                  {listing.inventoryInitState ?? "—"} / {listing.inventoryDriftState ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Shopify inventory</dt>
                <dd>
                  Desired {listing.inventoryDesiredAvailable ?? "—"} · Applied{" "}
                  {listing.inventoryAppliedAvailable ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">Last reconciled</dt>
                <dd>
                  {listing.lastReconciledAt
                    ? new Date(listing.lastReconciledAt).toLocaleString()
                    : "Not yet"}
                </dd>
              </div>
              {listing.issueMessage ? (
                <div>
                  <dt className="text-neutral-500">Needs attention</dt>
                  <dd className="text-amber-900">
                    {listing.issueSeverity ? `[${listing.issueSeverity}] ` : ""}
                    {listing.issueMessage}
                    {listing.issueCode ? ` (${listing.issueCode})` : ""}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <div className="flex flex-wrap gap-3">
            <Link href={`/seller-hub/store/${listing.storeItemId}`} className="btn" prefetch={false}>
              View / edit INW listing
            </Link>
            <button
              type="button"
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              disabled={refreshing}
              onClick={() => void load(true)}
            >
              {refreshing ? "Refreshing…" : "Refresh / reconcile"}
            </button>
            {adminUrl ? (
              <a
                href={adminUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn border border-gray-300 bg-white hover:bg-gray-50"
                style={{ color: "var(--color-heading)" }}
              >
                Open in Shopify Admin
              </a>
            ) : null}
            {listing.contentHealth === "PAUSED" || listing.readiness === "ACTION_REQUIRED" ? (
              <p className="text-sm text-neutral-600 self-center">
                Content conflicts are resolved by editing the INW listing, then refreshing status.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </AppsAirportChrome>
  );
}
