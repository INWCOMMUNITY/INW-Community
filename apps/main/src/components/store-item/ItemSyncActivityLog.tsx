"use client";

import { useCallback, useEffect, useState } from "react";

type SyncEvent = {
  id: string;
  provider: string;
  storeItemId: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  wix: "Wix",
  shopify: "Shopify",
};

const ACTION_LABEL: Record<string, string> = {
  push_inventory: "Inventory pushed",
  push_content: "Content pushed",
  pull_catalog: "Catalog pulled",
  sale_applied: "Sale applied",
  conflict_resolved: "Conflict resolved",
  token_refreshed: "Token refreshed",
  token_expired: "Connection issue",
  import: "Listings imported",
  error: "Sync error",
};

const ACTION_COLOR: Record<string, string> = {
  push_inventory: "text-blue-600",
  push_content: "text-blue-600",
  pull_catalog: "text-purple-600",
  sale_applied: "text-green-600",
  conflict_resolved: "text-amber-600",
  token_refreshed: "text-gray-500",
  token_expired: "text-red-600",
  import: "text-cyan-600",
  error: "text-red-600",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type ItemSyncActivityLogProps = {
  storeItemId: string;
  refreshKey?: number;
};

export function ItemSyncActivityLog({ storeItemId, refreshKey = 0 }: ItemSyncActivityLogProps) {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        storeItemId,
        limit: "10",
      });
      const res = await fetch(`/api/me/sync-log?${qs}`, { credentials: "include" });
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [storeItemId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-500">Loading sync history…</p>
      </div>
    );
  }

  if (events.length === 0) return null;

  const displayed = expanded ? events : events.slice(0, 5);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800 mb-3">Sync history for this item</h3>
      <div className="space-y-2">
        {displayed.map((e) => (
          <div key={e.id} className="flex items-start gap-3 py-1 border-b border-gray-50 last:border-0">
            <span
              className={`text-xs font-medium whitespace-nowrap ${ACTION_COLOR[e.action] ?? "text-gray-500"}`}
            >
              {ACTION_LABEL[e.action] ?? e.action}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-xs text-gray-500">{PROVIDER_LABEL[e.provider] ?? e.provider}</span>
              {e.detail ? <p className="text-xs text-gray-600 truncate">{e.detail}</p> : null}
            </div>
            <span className="text-xs text-gray-400 whitespace-nowrap">{formatTime(e.createdAt)}</span>
          </div>
        ))}
      </div>
      {events.length > 5 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-xs text-[var(--color-primary)] font-medium mt-2 hover:underline"
        >
          Show more
        </button>
      ) : null}
    </div>
  );
}
