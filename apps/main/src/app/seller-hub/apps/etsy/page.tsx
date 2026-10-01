"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppsAirportChannelHub } from "@/components/apps-airport/AppsAirportChannelHub";
import {
  APPS_AIRPORT_ETSY_HUB,
  appsAirportEtsyHubTitle,
  classifyEtsyConnectionUi,
  etsyConnectionStatusLabel,
} from "@/lib/etsy/apps-airport";

type PublicConnection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
};

export default function AppsAirportEtsyPage() {
  const [connection, setConnection] = useState<PublicConnection | null>(null);
  const [mappedCount, setMappedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hub = APPS_AIRPORT_ETSY_HUB;

  useEffect(() => {
    void Promise.all([
      fetch("/api/etsy/connection", { credentials: "include" }),
      fetch("/api/etsy/listings", { credentials: "include" }),
    ])
      .then(async ([connRes, listRes]) => {
        if (!connRes.ok) {
          setError("Could not load Etsy connection.");
          return;
        }
        const body = (await connRes.json()) as { connections: PublicConnection[] };
        setConnection(body.connections.find((c) => c.status === "ACTIVE") ?? null);
        if (listRes.ok) {
          const listingsBody = (await listRes.json()) as {
            connection: { mappedListingCount?: number } | null;
          };
          setMappedCount(listingsBody.connection?.mappedListingCount ?? 0);
        }
      })
      .catch(() => setError("Could not load Etsy connection."))
      .finally(() => setLoading(false));
  }, []);

  const uiStatus = classifyEtsyConnectionUi(connection);
  const statusLabel = etsyConnectionStatusLabel(uiStatus);

  return (
    <AppsAirportChannelHub
      title={appsAirportEtsyHubTitle(hub.displayName, statusLabel)}
      subtitle="Import Etsy listings into INW, then keep content and inventory in sync both ways."
      crumbs={[{ href: hub.hubPath, label: hub.displayName }]}
      actions={[
        {
          label: hub.importLabel,
          href: hub.importPath,
          disabled: uiStatus === "disconnected",
        },
        {
          label: hub.listItemsLabel,
          href: hub.listItemsPath,
          disabled: uiStatus === "disconnected",
        },
        {
          label: "Mapped Listings",
          href: hub.listingsPath,
          disabled: uiStatus === "disconnected",
        },
        {
          label: hub.settingsLabel,
          href: hub.settingsPath,
        },
      ]}
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {!loading && uiStatus === "disconnected" ? (
        <p className="mb-6 text-sm text-neutral-600">
          Connect Etsy to unlock import and listing.{" "}
          <Link
            href={hub.settingsPath}
            className="underline"
            style={{ color: "var(--color-primary)" }}
            prefetch={false}
          >
            Connection settings
          </Link>
        </p>
      ) : null}
      {!loading && uiStatus === "connected" ? (
        <p className="mb-6 text-sm text-neutral-700">
          Connected to {connection?.shopName ?? `Shop #${connection?.shopId}`}.
          {mappedCount != null ? ` ${mappedCount} mapped listing${mappedCount === 1 ? "" : "s"}.` : null}{" "}
          Complete How it’s made on each listing, set a shipping profile in settings, then use List Items
          on Etsy.
        </p>
      ) : null}
    </AppsAirportChannelHub>
  );
}
