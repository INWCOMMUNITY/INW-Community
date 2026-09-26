"use client";

import { FormEvent, useEffect, useState } from "react";

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

export default function SellerShopifyConnectionPage() {
  const [shop, setShop] = useState("");
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/shopify/connection");
    if (!response.ok) {
      setError("Could not load Shopify connection.");
      return;
    }
    const body = (await response.json()) as { connections: PublicConnection[] };
    setConnections(body.connections);
    const active = body.connections.find((connection) => connection.status === "ACTIVE");
    setSelectedConnectionId(active?.id ?? null);
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
    void fetch(`/api/shopify/locations?connectionId=${encodeURIComponent(active.id)}`)
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

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Shopify</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Connect one Shopify shop. Inventory sync uses a single location after you choose it.
      </p>
      <p className="mt-2 text-sm text-neutral-600">
        Enter your Shopify store address, such as your-store.myshopify.com. You can find it in
        Shopify Admin → Settings → Domains. You may also paste your Shopify store URL.
      </p>
      {message ? <p className="mt-4 text-sm">{message}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      <form onSubmit={onConnect} className="mt-6 flex gap-2">
        <input
          aria-label="Shopify shop domain"
          className="flex-1 rounded border px-3 py-2"
          placeholder="your-store.myshopify.com"
          value={shop}
          onChange={(event) => setShop(event.target.value)}
        />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">
          Connect
        </button>
      </form>
      {active ? (
        <section className="mt-8 rounded border p-4">
          <p className="font-medium">{active.shopDomain}</p>
          <p className="text-sm text-neutral-600">Generation {active.generation}</p>
          <p className="text-sm">{active.inventoryReady ? "Location ready" : "Choose a location before inventory sync"}</p>
          {active.locationSelectionRequired && locations.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {locations.map((location) => (
                <li key={location.id}>
                  <button className="underline" type="button" onClick={() => onSelectLocation(location.id)}>
                    Use {location.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button className="mt-4 text-sm underline" type="button" onClick={() => onDisconnect(active.id)}>
            Disconnect
          </button>
        </section>
      ) : null}
    </main>
  );
}
