"use client";

import { useEffect, useState } from "react";
import {
  classifyEtsyConnectionUi,
  etsyConnectionStatusLabel,
} from "@/lib/etsy/apps-airport";

type PublicConnection = {
  id: string;
  shopId: string;
  shopName: string | null;
  etsyUserId: string;
  generation: number;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
};

type ShippingProfile = { id: string; title: string };

export function EtsyConnectionPanel({
  heading = "Connection settings",
  showHeading = true,
}: {
  heading?: string;
  showHeading?: boolean;
}) {
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ShippingProfile[]>([]);
  const [defaultShippingProfileId, setDefaultShippingProfileId] = useState("");
  const [defaultTaxonomyId, setDefaultTaxonomyId] = useState("");
  const [savingDefaults, setSavingDefaults] = useState(false);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/etsy/connection", { credentials: "include" });
    if (!response.ok) {
      setError("Could not load Etsy connection.");
      setLoading(false);
      return;
    }
    const body = (await response.json()) as { connections: PublicConnection[] };
    setConnections(body.connections);
    setLoading(false);

    const active = body.connections.find((c) => c.status === "ACTIVE");
    if (active) {
      const profilesRes = await fetch("/api/etsy/shipping-profiles", { credentials: "include" });
      if (profilesRes.ok) {
        const profilesBody = (await profilesRes.json()) as {
          profiles: ShippingProfile[];
          defaultShippingProfileId: string | null;
          defaultTaxonomyId: number | null;
        };
        setProfiles(profilesBody.profiles ?? []);
        setDefaultShippingProfileId(profilesBody.defaultShippingProfileId ?? "");
        setDefaultTaxonomyId(
          profilesBody.defaultTaxonomyId != null ? String(profilesBody.defaultTaxonomyId) : ""
        );
      }
    } else {
      setProfiles([]);
      setDefaultShippingProfileId("");
      setDefaultTaxonomyId("");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("etsy") === "connected") setMessage("Etsy connected.");
    const oauthError = params.get("etsy_error");
    if (oauthError) {
      const messages: Record<string, string> = {
        invalid_state:
          "Etsy connection could not be verified (browser session mismatch). Try Connect Etsy again from this same browser tab.",
        invalid_callback: "Etsy returned an incomplete authorization. Try connecting again.",
        token_exchange: "Etsy token exchange failed. Check API keys and try again.",
        scopes: "Etsy did not grant the required shop scopes. Re-approve all requested permissions.",
        shop_identity: "Could not verify your Etsy shop after login.",
        shop_owned: "That Etsy shop is already connected to another INW account.",
        not_configured: "Etsy is not configured on this environment.",
      };
      setError(messages[oauthError] ?? `Etsy connection was not completed (${oauthError}).`);
    }
    void load();
  }, []);

  async function onConnect() {
    setError(null);
    const response = await fetch("/api/etsy/connect", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = (await response.json()) as { authorizeUrl?: string; error?: string };
    if (!response.ok || !body.authorizeUrl) {
      setError(body.error ?? "Could not start Etsy connection.");
      return;
    }
    window.location.assign(body.authorizeUrl);
  }

  async function onDisconnect(connectionId: string) {
    setError(null);
    const response = await fetch("/api/etsy/disconnect", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    });
    if (!response.ok) {
      setError("Could not disconnect Etsy.");
      return;
    }
    setMessage("Etsy disconnected.");
    await load();
  }

  async function onSaveDefaults() {
    setSavingDefaults(true);
    setError(null);
    try {
      const response = await fetch("/api/etsy/shipping-profiles", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultShippingProfileId: defaultShippingProfileId || null,
          defaultTaxonomyId: defaultTaxonomyId || null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not save Etsy defaults.");
        return;
      }
      setMessage("Etsy publish defaults saved.");
    } finally {
      setSavingDefaults(false);
    }
  }

  const active = connections.find((connection) => connection.status === "ACTIVE") ?? null;
  const uiStatus = classifyEtsyConnectionUi(active);
  const statusLabel = etsyConnectionStatusLabel(uiStatus);

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
        Connect your Etsy shop to sync listings with INW. You will authorize INW on Etsy; no shop
        URL is required.
      </p>
      {message ? <p className="mt-3 text-sm text-emerald-800">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <div className="mt-4 rounded-[10px] border border-neutral-200 p-4">
        <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
          Status: {loading ? "…" : statusLabel}
        </p>
        {active ? (
          <p className="mt-2 text-sm text-neutral-700">
            Shop: {active.shopName ?? `Shop #${active.shopId}`}
          </p>
        ) : (
          <p className="mt-2 text-sm text-neutral-600">No Etsy shop connected yet.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          {!active ? (
            <button type="button" className="btn" onClick={() => void onConnect()}>
              Connect Etsy
            </button>
          ) : (
            <button
              type="button"
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              onClick={() => void onDisconnect(active.id)}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {active ? (
        <div className="mt-4 rounded-[10px] border border-neutral-200 p-4 space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Publish defaults
          </p>
          <p className="text-xs text-neutral-500">
            Required before List on Etsy. Shipping profile activates new listings; taxonomy is the
            fallback category when a listing omits one.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="etsyShippingProfile">
              Default shipping profile
            </label>
            <select
              id="etsyShippingProfile"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={defaultShippingProfileId}
              onChange={(e) => setDefaultShippingProfileId(e.target.value)}
            >
              <option value="">Select a profile…</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="etsyTaxonomyDefault">
              Default taxonomy ID
            </label>
            <input
              id="etsyTaxonomyDefault"
              type="text"
              inputMode="numeric"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={defaultTaxonomyId}
              onChange={(e) => setDefaultTaxonomyId(e.target.value.replace(/\D/g, "").slice(0, 12))}
              placeholder="e.g. 69150467"
            />
          </div>
          <button
            type="button"
            className="btn"
            disabled={savingDefaults}
            onClick={() => void onSaveDefaults()}
          >
            {savingDefaults ? "Saving…" : "Save defaults"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
