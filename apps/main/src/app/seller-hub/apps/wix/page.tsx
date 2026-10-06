"use client";

import { useCallback, useEffect, useState } from "react";
import { AppsAirportChannelHub } from "@/components/apps-airport/AppsAirportChannelHub";
import { APPS_AIRPORT_PATH, APPS_AIRPORT_WIX_PATH } from "@/lib/wix/apps-airport";
import {
  appsAirportWixHubTitle,
  classifyWixConnectionUi,
  wixConnectionStatusLabel,
} from "@/lib/wix/apps-airport";

type WixStatus = {
  configured: boolean;
  connected: boolean;
  connection: {
    shopName: string | null;
    siteId: string;
    catalogVersion: string;
    status: string;
  } | null;
  stats: {
    totalListings: number;
    synced: number;
    syncing: number;
    actionRequired: number;
  };
  health: {
    overall: "healthy" | "degraded" | "disconnected" | "not_configured";
    pendingJobs: number;
    issueCount: number;
  };
};

type WixIssue = {
  listingLinkId: string;
  title: string;
  issueMessage: string;
  issueSeverity: string;
};

export default function WixAppsAirportPage() {
  const [status, setStatus] = useState<WixStatus | null>(null);
  const [issues, setIssues] = useState<WixIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [statusRes, issuesRes] = await Promise.all([
        fetch("/api/wix/status", { credentials: "include" }),
        fetch("/api/wix/issues", { credentials: "include" }),
      ]);
      if (!statusRes.ok) {
        setError("Could not load Wix status.");
        return;
      }
      setStatus((await statusRes.json()) as WixStatus);
      if (issuesRes.ok) {
        const body = (await issuesRes.json()) as { issues: WixIssue[] };
        setIssues(body.issues ?? []);
      }
    } catch {
      setError("Could not load Wix status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/wix/connect", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not start Wix connection.");
        setConnecting(false);
        return;
      }
      const body = (await res.json()) as { authorizeUrl: string };
      window.location.href = body.authorizeUrl;
    } catch {
      setError("Could not start Wix connection.");
      setConnecting(false);
    }
  }, []);

  const ui = classifyWixConnectionUi(
    status ? { connected: status.connected, health: status.health.overall } : null
  );
  const connected = status?.connected ?? false;
  const shopName = status?.connection?.shopName || status?.connection?.siteId || "Wix";

  return (
    <AppsAirportChannelHub
      title={appsAirportWixHubTitle(shopName, wixConnectionStatusLabel(ui))}
      subtitle="Wix catalog sync"
      crumbs={[{ href: APPS_AIRPORT_PATH, label: "Apps Airport" }]}
      actions={
        connected
          ? [{ label: "Refresh", href: APPS_AIRPORT_WIX_PATH }]
          : [{ label: "Refresh", href: APPS_AIRPORT_WIX_PATH }]
      }
      statusDetail={
        status?.connection
          ? `Catalog ${status.connection.catalogVersion} · ${status.stats.totalListings} linked listings`
          : "No Wix site connected yet."
      }
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {!connected && status?.configured !== false && (
        <div className="mb-6 rounded border border-neutral-300 bg-neutral-50 p-4">
          <p className="mb-3 text-sm text-neutral-700">
            Connect your Wix site to sync INW listings with your Wix store.
          </p>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="btn"
            style={{ minWidth: 160 }}
          >
            {connecting ? "Connecting…" : "Connect Wix"}
          </button>
        </div>
      )}

      {status?.configured === false && (
        <p className="mb-4 text-sm text-amber-700">
          Wix integration is not configured. Contact support if you expected this to be available.
        </p>
      )}

      {status && connected ? (
        <div className="space-y-4">
          <p className="text-sm text-neutral-700">
            {status.stats.synced} ready · {status.stats.syncing} syncing · {status.stats.actionRequired} need
            attention · {status.health.pendingJobs} jobs waiting
          </p>
          {issues.length === 0 ? (
            <p className="text-sm text-neutral-600">No Wix listing issues.</p>
          ) : (
            <ul className="space-y-2">
              {issues.map((issue) => (
                <li key={issue.listingLinkId} className="rounded border border-neutral-200 p-3 text-sm">
                  <p className="font-semibold">{issue.title}</p>
                  <p className="text-neutral-700">{issue.issueMessage}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : status && !connected ? (
        <p className="text-sm text-neutral-600">
          {status.stats.synced} ready · {status.stats.syncing} syncing · {status.stats.actionRequired} need
          attention · {status.health.pendingJobs} jobs waiting
        </p>
      ) : (
        <p className="text-sm text-neutral-600">Loading Wix status…</p>
      )}
    </AppsAirportChannelHub>
  );
}
