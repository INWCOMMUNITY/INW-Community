"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_ETSY_PATH,
  APPS_AIRPORT_ETSY_SETTINGS_PATH,
  classifyEtsyConnectionUi,
  etsyConnectionStatusLabel,
} from "@/lib/etsy/apps-airport";
import {
  APPS_AIRPORT_MARKETPLACES,
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  classifyShopifyConnectionUi,
  shopifyConnectionStatusLabel,
} from "@/lib/shopify/apps-airport";
import {
  APPS_AIRPORT_WIX_PATH,
  APPS_AIRPORT_WIX_SETTINGS_PATH,
  classifyWixConnectionUi,
  wixConnectionStatusLabel,
} from "@/lib/wix/apps-airport";

type ShopifyPublicConnection = {
  id: string;
  shopDomain: string;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
  generation: number;
};

type EtsyPublicConnection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
};

type WixStatusResponse = {
  connected: boolean;
  connection: { shopName: string | null; siteId: string } | null;
  health: { overall: "healthy" | "degraded" | "disconnected" | "not_configured" };
};

export default function AppsAirportPage() {
  const [shopifyConnections, setShopifyConnections] = useState<ShopifyPublicConnection[]>([]);
  const [etsyConnections, setEtsyConnections] = useState<EtsyPublicConnection[]>([]);
  const [wixStatus, setWixStatus] = useState<WixStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch("/api/shopify/connection", { credentials: "include" }),
      fetch("/api/etsy/connection", { credentials: "include" }),
      fetch("/api/wix/status", { credentials: "include" }),
    ])
      .then(async ([shopifyRes, etsyRes, wixRes]) => {
        if (!shopifyRes.ok && !etsyRes.ok && !wixRes.ok) {
          setError("Could not load marketplace connections.");
          return;
        }
        if (shopifyRes.ok) {
          const body = (await shopifyRes.json()) as { connections: ShopifyPublicConnection[] };
          setShopifyConnections(body.connections);
        }
        if (etsyRes.ok) {
          const body = (await etsyRes.json()) as { connections: EtsyPublicConnection[] };
          setEtsyConnections(body.connections);
        }
        if (wixRes.ok) {
          setWixStatus((await wixRes.json()) as WixStatusResponse);
        }
      })
      .catch(() => setError("Could not load marketplace connections."))
      .finally(() => setLoading(false));
  }, []);

  const activeShopify = shopifyConnections.find((c) => c.status === "ACTIVE") ?? null;
  const shopifyUi = classifyShopifyConnectionUi(activeShopify);
  const activeEtsy = etsyConnections.find((c) => c.status === "ACTIVE") ?? null;
  const etsyUi = classifyEtsyConnectionUi(activeEtsy);
  const wixUi = classifyWixConnectionUi(
    wixStatus
      ? { connected: wixStatus.connected, health: wixStatus.health.overall }
      : null
  );

  return (
    <AppsAirportChrome
      title="Apps Airport"
      subtitle="Connect marketplaces and manage synced listings from one place."
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {APPS_AIRPORT_MARKETPLACES.map((app) => {
          const isShopify = app.id === "shopify";
          const isEtsy = app.id === "etsy";
          const isWix = app.id === "wix";
          return (
            <article
              key={app.id}
              className="rounded-[10px] border-2 p-5 bg-white flex flex-col"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <h2
                  className="text-xl font-bold"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  {app.name}
                </h2>
                {isShopify ? (
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded"
                    style={{
                      backgroundColor:
                        shopifyUi === "connected"
                          ? "#e8f5e9"
                          : shopifyUi === "needs_attention"
                            ? "#fff8e1"
                            : "#f5f5f5",
                      color: "var(--color-heading)",
                    }}
                  >
                    {loading ? "…" : shopifyConnectionStatusLabel(shopifyUi)}
                  </span>
                ) : isEtsy ? (
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded"
                    style={{
                      backgroundColor: etsyUi === "connected" ? "#e8f5e9" : "#f5f5f5",
                      color: "var(--color-heading)",
                    }}
                  >
                    {loading ? "…" : etsyConnectionStatusLabel(etsyUi)}
                  </span>
                ) : isWix ? (
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded"
                    style={{
                      backgroundColor:
                        wixUi === "connected"
                          ? "#e8f5e9"
                          : wixUi === "needs_attention"
                            ? "#fff8e1"
                            : "#f5f5f5",
                      color: "var(--color-heading)",
                    }}
                  >
                    {loading ? "…" : wixConnectionStatusLabel(wixUi)}
                  </span>
                ) : (
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-neutral-100 text-neutral-600">
                    Coming later
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-neutral-600 flex-1">
                {isEtsy
                  ? "Connect your Etsy shop, set How it’s made on listings, then list from Apps Airport."
                  : isWix
                    ? "Sync INW listings with your Wix store."
                    : app.description}
              </p>
              {isShopify ? (
                <>
                  <p className="mt-3 text-sm text-neutral-700">
                    {activeShopify
                      ? `Shop: ${activeShopify.shopDomain}`
                      : "No Shopify shop connected yet."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {activeShopify ? (
                      <Link href={APPS_AIRPORT_SHOPIFY_PATH} className="btn" prefetch={false}>
                        Manage
                      </Link>
                    ) : (
                      <Link
                        href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH}
                        className="btn"
                        prefetch={false}
                      >
                        Connect
                      </Link>
                    )}
                    {activeShopify && shopifyUi === "needs_attention" ? (
                      <Link
                        href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH}
                        className="btn border border-gray-300 bg-white hover:bg-gray-50"
                        prefetch={false}
                        style={{ color: "var(--color-heading)" }}
                      >
                        Finish setup
                      </Link>
                    ) : null}
                  </div>
                </>
              ) : isEtsy ? (
                <>
                  <p className="mt-3 text-sm text-neutral-700">
                    {activeEtsy
                      ? `Shop: ${activeEtsy.shopName ?? `#${activeEtsy.shopId}`}`
                      : "No Etsy shop connected yet."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {activeEtsy ? (
                      <Link href={APPS_AIRPORT_ETSY_PATH} className="btn" prefetch={false}>
                        Manage
                      </Link>
                    ) : (
                      <Link href={APPS_AIRPORT_ETSY_SETTINGS_PATH} className="btn" prefetch={false}>
                        Connect
                      </Link>
                    )}
                  </div>
                </>
              ) : isWix ? (
                <>
                  <p className="mt-3 text-sm text-neutral-700">
                    {wixStatus?.connection
                      ? `Site: ${wixStatus.connection.shopName ?? wixStatus.connection.siteId}`
                      : "No Wix site connected yet."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {wixStatus?.connected ? (
                      <Link href={APPS_AIRPORT_WIX_PATH} className="btn" prefetch={false}>
                        Manage
                      </Link>
                    ) : (
                      <Link href={APPS_AIRPORT_WIX_SETTINGS_PATH} className="btn" prefetch={false}>
                        Connect
                      </Link>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-neutral-500">Not available yet.</p>
              )}
            </article>
          );
        })}
      </div>
    </AppsAirportChrome>
  );
}
