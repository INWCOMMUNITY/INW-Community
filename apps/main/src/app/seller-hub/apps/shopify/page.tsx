"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_SHOPIFY_IMPORT_PATH,
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_SYNC_PATH,
  classifyShopifyConnectionUi,
  shopifyConnectionStatusLabel,
  shopifyHealthLabel,
  shopifyReadinessLabel,
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

type ListingRow = {
  storeItemId: string;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
};

export default function AppsAirportShopifyPage() {
  const [connection, setConnection] = useState<PublicConnection | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [connRes, listRes] = await Promise.all([
          fetch("/api/shopify/connection", { credentials: "include" }),
          fetch("/api/shopify/listings", { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (!connRes.ok) {
          setError("Could not load Shopify connection.");
          return;
        }
        const connBody = (await connRes.json()) as { connections: PublicConnection[] };
        const active = connBody.connections.find((c) => c.status === "ACTIVE") ?? null;
        setConnection(active);
        if (listRes.ok) {
          const listBody = (await listRes.json()) as { listings: ListingRow[] };
          setListings(listBody.listings ?? []);
        }
      } catch {
        if (!cancelled) setError("Could not load Shopify management.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const uiStatus = classifyShopifyConnectionUi(connection);
  const needsAttentionCount = useMemo(
    () =>
      listings.filter(
        (row) =>
          row.readiness === "ACTION_REQUIRED" ||
          row.contentHealth === "PAUSED" ||
          row.inventoryHealth === "PAUSED" ||
          row.contentHealth === "DEGRADED" ||
          row.inventoryHealth === "DEGRADED"
      ).length,
    [listings]
  );

  const actions = [
    {
      href: APPS_AIRPORT_SHOPIFY_SYNC_PATH,
      label: "Sync a listing",
      description: "Export a new INW listing to Shopify as ACTIVE and published to Online Store.",
      enabled: uiStatus === "connected",
    },
    {
      href: APPS_AIRPORT_SHOPIFY_IMPORT_PATH,
      label: "Import listings",
      description: "Bring unmapped Shopify products into INW when supported.",
      enabled: true,
    },
    {
      href: APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
      label: "Synced listings",
      description: "Review mapped listings, health, and readiness.",
      enabled: uiStatus !== "disconnected",
    },
    {
      href: APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
      label: "Connection settings",
      description: "Connect, choose location, or disconnect Shopify.",
      enabled: true,
    },
  ];

  return (
    <AppsAirportChrome
      title="Shopify"
      subtitle="Manage your Shopify connection, sync new listings, and review synced inventory."
      crumbs={[{ href: "/seller-hub/apps/shopify", label: "Shopify" }]}
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      <div
        className="rounded-[10px] border-2 p-5 mb-8"
        style={{ borderColor: "var(--color-primary)" }}
      >
        {loading ? (
          <p className="text-sm text-neutral-600">Loading Shopify status…</p>
        ) : (
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
              {shopifyConnectionStatusLabel(uiStatus)}
            </p>
            {connection ? (
              <div className="mt-2 grid gap-1 text-sm text-neutral-700">
                <p>
                  Shop: <span className="font-medium">{connection.shopDomain}</span>
                </p>
                <p>Generation: {connection.generation}</p>
                <p>
                  Primary location:{" "}
                  {connection.primaryLocationId ? "Selected" : "Needs selection"}
                </p>
                <p>Synced listings: {listings.length}</p>
                <p>Needs attention: {needsAttentionCount}</p>
                {listings[0] ? (
                  <p className="text-neutral-600">
                    Latest readiness: {shopifyReadinessLabel(listings[0].readiness)} · Content{" "}
                    {shopifyHealthLabel(listings[0].contentHealth)} · Inventory{" "}
                    {shopifyHealthLabel(listings[0].inventoryHealth)}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-neutral-600">
                Connect Shopify to start syncing listings.
              </p>
            )}
            {uiStatus === "disconnected" ? (
              <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="btn mt-4 inline-block" prefetch={false}>
                Connect Shopify
              </Link>
            ) : null}
            {uiStatus === "needs_attention" ? (
              <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="btn mt-4 inline-block" prefetch={false}>
                Finish connection setup
              </Link>
            ) : null}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.enabled ? action.href : APPS_AIRPORT_SHOPIFY_SETTINGS_PATH}
            prefetch={false}
            className="rounded-[10px] border-2 p-4 bg-white hover:bg-[var(--color-section-alt)] transition"
            style={{
              borderColor: "var(--color-primary)",
              opacity: action.enabled ? 1 : 0.85,
            }}
          >
            <h2 className="font-bold" style={{ color: "var(--color-heading)" }}>
              {action.label}
            </h2>
            <p className="mt-1 text-sm text-neutral-600">{action.description}</p>
            {!action.enabled ? (
              <p className="mt-2 text-xs text-amber-800">Connect Shopify first to use this action.</p>
            ) : null}
          </Link>
        ))}
      </div>
    </AppsAirportChrome>
  );
}
