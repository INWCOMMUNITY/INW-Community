"use client";

import { useEffect, useState } from "react";
import {
  classifyWixConnectionUi,
  wixConnectionStatusLabel,
} from "@/lib/wix/apps-airport";

type PublicConnection = {
  id: string;
  instanceId: string;
  siteId: string;
  shopName: string | null;
  catalogVersion: string;
  status: "ACTIVE" | "DISCONNECTED";
  generation: number;
  connectedAt: string;
};

export function WixConnectionPanel({
  heading = "Connection Settings",
  showHeading = true,
}: {
  heading?: string;
  showHeading?: boolean;
}) {
  const [connection, setConnection] = useState<PublicConnection | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/wix/connection", { credentials: "include" });
      if (!response.ok) {
        setError("Could not load Wix connection.");
        setConnection(null);
        return;
      }
      const body = (await response.json()) as { connection: PublicConnection | null };
      setConnection(body.connection);
    } catch {
      setError("Could not load Wix connection.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("wix_connected") === "true") setMessage("Wix connected.");
    const oauthError = params.get("wix_error");
    const oauthMessage = params.get("wix_error_message");
    if (oauthError || oauthMessage) {
      setError(oauthMessage ?? `Wix connection was not completed (${oauthError}).`);
    }
    void load();
  }, []);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/wix/connect", {
        method: "POST",
        credentials: "include",
      });
      const body = (await response.json()) as { authorizeUrl?: string; error?: string };
      if (!response.ok || !body.authorizeUrl) {
        setError(body.error ?? "Could not start Wix connection.");
        setBusy(false);
        return;
      }
      window.location.href = body.authorizeUrl;
    } catch {
      setError("Could not start Wix connection.");
      setBusy(false);
    }
  }

  async function onDisconnect() {
    if (!connection) return;
    const ok = window.confirm(
      "Disconnect Wix?\n\nLinked listings stay in INW but will stop syncing until you reconnect."
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/wix/disconnect", {
        method: "POST",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not disconnect Wix.");
        setBusy(false);
        return;
      }
      setMessage("Wix disconnected.");
      setConnection(null);
    } catch {
      setError("Could not disconnect Wix.");
    } finally {
      setBusy(false);
    }
  }

  const ui = classifyWixConnectionUi(
    connection ? { connected: connection.status === "ACTIVE" } : null
  );

  return (
    <div className="space-y-4">
      {showHeading ? (
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-heading)" }}>
          {heading}
        </h2>
      ) : null}
      {message ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? (
        <p className="text-sm text-neutral-600">Loading connection…</p>
      ) : connection ? (
        <div className="rounded border border-neutral-200 p-4 space-y-2">
          <p className="text-sm">
            Status: <strong>{wixConnectionStatusLabel(ui)}</strong>
          </p>
          <p className="text-sm text-neutral-700">
            Site: {connection.shopName ?? connection.siteId}
          </p>
          <p className="text-sm text-neutral-700">Catalog: {connection.catalogVersion}</p>
          <div className="pt-2 flex flex-wrap gap-3">
            <button type="button" className="btn" disabled={busy} onClick={onConnect}>
              {busy ? "Working…" : "Reconnect"}
            </button>
            <button
              type="button"
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              disabled={busy}
              onClick={onDisconnect}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded border border-neutral-200 p-4 space-y-3">
          <p className="text-sm text-neutral-700">
            Connect your Wix site to import products and list INW items on Wix.
          </p>
          <button type="button" className="btn" disabled={busy} onClick={onConnect}>
            {busy ? "Connecting…" : "Connect Wix"}
          </button>
        </div>
      )}
    </div>
  );
}
