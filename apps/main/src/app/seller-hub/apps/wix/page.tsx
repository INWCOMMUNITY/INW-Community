"use client";

import { useEffect, useState } from "react";
import { AppsAirportChannelHub } from "@/components/apps-airport/AppsAirportChannelHub";
import { APPS_AIRPORT_PATH } from "@/lib/wix/apps-airport";
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

  useEffect(() => {
    void Promise.all([
      fetch("/api/wix/status", { credentials: "include" }),
      fetch("/api/wix/issues", { credentials: "include" }),
    ])
      .then(async ([statusRes, issuesRes]) => {
        if (!statusRes.ok) {
          setError("Could not load Wix status.");
          return;
        }
        setStatus((await statusRes.json()) as WixStatus);
        if (issuesRes.ok) {
          const body = (await issuesRes.json()) as { issues: WixIssue[] };
          setIssues(body.issues ?? []);
        }
      })
      .catch(() => setError("Could not load Wix status."));
  }, []);

  const ui = classifyWixConnectionUi(
    status ? { connected: status.connected, health: status.health.overall } : null
  );
  const shopName = status?.connection?.shopName || status?.connection?.siteId || "Wix";

  return (
    <AppsAirportChannelHub
      title={appsAirportWixHubTitle(shopName, wixConnectionStatusLabel(ui))}
      subtitle="Wix catalog sync"
      crumbs={[{ href: APPS_AIRPORT_PATH, label: "Apps Airport" }]}
      actions={[{ label: "Refresh", href: APPS_AIRPORT_PATH + "/wix" }]}
      statusDetail={
        status?.connection
          ? `Catalog ${status.connection.catalogVersion} · ${status.stats.totalListings} linked listings`
          : "No Wix site connected yet."
      }
    >
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {status ? (
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
      ) : (
        <p className="text-sm text-neutral-600">Loading Wix status…</p>
      )}
    </AppsAirportChannelHub>
  );
}
