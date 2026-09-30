"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  classifyShopifyConnectionUi,
  shopifyConnectionStatusLabel,
} from "@/lib/shopify/apps-airport";

type PublicConnection = {
  id: string;
  shopDomain: string;
  shopId: string;
  generation: number;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
  primaryLocationId: string | null;
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
};

type LocationOption = { id: string; name: string };

export function ShopifyConnectionPanel({
  heading = "Connection settings",
  showHeading = true,
}: {
  heading?: string;
  showHeading?: boolean;
}) {
  const [shop, setShop] = useState("");
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/shopify/connection", { credentials: "include" });
    if (!response.ok) {
      setError("Could not load Shopify connection.");
      setLoading(false);
      return;
    }
    const body = (await response.json()) as { connections: PublicConnection[] };
    setConnections(body.connections);
    const active = body.connections.find((connection) => connection.status === "ACTIVE");
    setSelectedConnectionId(active?.id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify") === "connected") setMessage("Shopify connected.");
    const oauthError = params.get("shopify_error");
    if (oauthError) setError("Shopify connection was not completed.");
    void load();
  }, []);

  useEffect(() => {
    const active = connections.find((connection) => connection.id === selectedConnectionId);
    if (!active || active.status !== "ACTIVE" || !active.locationSelectionRequired) {
      setLocations([]);
      return;
    }
    void fetch(`/api/shopify/locations?connectionId=${encodeURIComponent(active.id)}`, {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { locations: LocationOption[] };
        setLocations(body.locations);
      })
      .catch(() => setError("Could not load Shopify locations."));
  }, [connections, selectedConnectionId]);

  async function onConnect(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/shopify/connect", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop }),
    });
    const body = (await response.json()) as { authorizeUrl?: string; error?: string };
    if (!response.ok || !body.authorizeUrl) {
      setError(body.error ?? "Could not start Shopify connection.");
      return;
    }
    window.location.assign(body.authorizeUrl);
  }

  async function onSelectLocation(locationId: string) {
    if (!selectedConnectionId) return;
    setError(null);
    const response = await fetch("/api/shopify/location", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: selectedConnectionId, locationId }),
    });
    if (!response.ok) {
      setError("Could not save the Shopify location.");
      return;
    }
    setMessage("Primary Shopify location saved.");
    await load();
  }

  async function onDisconnect(connectionId: string) {
    setError(null);
    const response = await fetch("/api/shopify/disconnect", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    });
    if (!response.ok) {
      setError("Could not disconnect Shopify.");
      return;
    }
    setMessage("Shopify disconnected.");
    await load();
  }

  const active = connections.find((connection) => connection.status === "ACTIVE") ?? null;
  const uiStatus = classifyShopifyConnectionUi(active);
  const statusLabel = shopifyConnectionStatusLabel(uiStatus);

  return (
    <div className="mx-auto max-w-xl">
      {showHeading ? (
        <h2
          className="text-xl font-semibold"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          {heading}
        </h2>
      ) : null}
      <p className="mt-2 text-sm text-neutral-600">
        Connect one Shopify shop. Inventory sync uses a single location after you choose it.
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        If your store uses a custom domain, you can find your Shopify store address in Shopify
        Admin → Settings → Domains.
      </p>
      <p className="mt-1 text-sm text-neutral-600">
        Enter your store as <span className="font-medium">your-store.myshopify.com</span>, a full
        store URL, or a supported Shopify Admin URL.
      </p>

      {message ? <p className="mt-4 text-sm text-green-800">{message}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      {loading ? <p className="mt-6 text-sm text-neutral-600">Loading connection…</p> : null}

      {!loading ? (
        <div className="mt-4 rounded-[10px] border-2 p-4" style={{ borderColor: "var(--color-primary)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Status: {statusLabel}
          </p>
          {active ? (
            <>
              <p className="mt-2 font-medium">{active.shopDomain}</p>
              <p className="text-sm text-neutral-600">Generation {active.generation}</p>
              <p className="text-sm text-neutral-600">
                Primary location:{" "}
                {active.primaryLocationId
                  ? "Selected"
                  : "Not selected — required before syncing inventory"}
              </p>
              <p className="text-sm">
                {active.inventoryReady
                  ? "Location ready for inventory sync"
                  : "Choose a location before inventory sync"}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-600">No active Shopify shop connected.</p>
          )}
        </div>
      ) : null}

      {!active ? (
        <form onSubmit={onConnect} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            aria-label="Shopify shop domain"
            className="flex-1 rounded border px-3 py-2"
            placeholder="your-store.myshopify.com"
            value={shop}
            onChange={(event) => setShop(event.target.value)}
          />
          <button className="btn whitespace-nowrap" type="submit">
            Connect Shopify
          </button>
        </form>
      ) : null}

      {active && active.locationSelectionRequired && locations.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {locations.map((location) => (
            <li key={location.id}>
              <button
                className="underline text-sm"
                type="button"
                style={{ color: "var(--color-primary)" }}
                onClick={() => onSelectLocation(location.id)}
              >
                Use {location.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {active ? (
        <button
          className="mt-6 text-sm underline text-red-700"
          type="button"
          onClick={() => onDisconnect(active.id)}
        >
          Disconnect
        </button>
      ) : null}
    </div>
  );
}
