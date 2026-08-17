"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import { isEbayConditionSyncError } from "@/lib/channels/ebay/conditions";
import { providerLabel } from "@/lib/channel-sync-feedback";

export type ChannelLinkSummary = {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  syncError: string | null;
  lastPushedAt: string | null;
  externalListingId?: string | null;
};

type ItemChannelSyncPanelProps = {
  storeItemId?: string;
  initialLinks?: ChannelLinkSummary[];
  hasConnections: boolean;
  skipSyncOnSave: boolean;
  onSkipSyncChange: (skip: boolean) => void;
  disabled?: boolean;
  onLinksUpdated?: (links: ChannelLinkSummary[]) => void;
  onFixEbayCondition?: () => void;
};

function formatRelativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function linkStatusLabel(link: ChannelLinkSummary): {
  tone: "green" | "red" | "gray" | "amber";
  text: string;
} {
  if (!link.syncEnabled) {
    return { tone: "gray", text: "Paused" };
  }
  if (link.syncStatus === "error") {
    const err = link.syncError?.trim();
    return {
      tone: "red",
      text: err ? err.slice(0, 120) : "Sync error",
    };
  }
  if (link.syncStatus === "pending") {
    return { tone: "amber", text: "Pending" };
  }
  return { tone: "green", text: "Synced" };
}

const toneClass: Record<string, string> = {
  green: "bg-green-50 text-green-800 border-green-200",
  red: "bg-red-50 text-red-800 border-red-200",
  gray: "bg-gray-50 text-gray-600 border-gray-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
};

type BusyAction = "sync" | "wix-diagnose" | "ebay-refresh" | "ebay-fix" | null;

export function ItemChannelSyncPanel({
  storeItemId,
  initialLinks = [],
  hasConnections,
  skipSyncOnSave,
  onSkipSyncChange,
  disabled,
  onLinksUpdated,
  onFixEbayCondition,
}: ItemChannelSyncPanelProps) {
  const [links, setLinks] = useState<ChannelLinkSummary[]>(initialLinks);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    setLinks(initialLinks);
  }, [initialLinks]);

  const refreshLinks = useCallback(async () => {
    if (!storeItemId) return;
    try {
      const res = await fetch(`/api/store-items/${storeItemId}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok && Array.isArray(data.channelLinks)) {
        const mapped = data.channelLinks.map((l: ChannelLinkSummary) => ({
          provider: l.provider,
          syncStatus: l.syncStatus,
          syncEnabled: l.syncEnabled ?? true,
          syncError: l.syncError ?? null,
          lastPushedAt: l.lastPushedAt ?? null,
          externalListingId: l.externalListingId ?? null,
        }));
        setLinks(mapped);
        onLinksUpdated?.(mapped);
      }
    } catch {
      /* ignore */
    }
  }, [storeItemId, onLinksUpdated]);

  async function runSyncNow() {
    if (!storeItemId) return;
    setBusyAction("sync");
    setActionMessage(null);
    try {
      const qs = new URLSearchParams({
        storeItemId,
        direction: "both",
      });
      const res = await fetch(`/api/channels/sync-now?${qs}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setActionMessage((data as { error?: string }).error ?? "Sync failed");
      } else {
        setActionMessage("Sync completed.");
        await refreshLinks();
      }
    } catch {
      setActionMessage("Sync failed. Try again.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runEbayRefresh() {
    if (!storeItemId) return;
    setBusyAction("ebay-refresh");
    setActionMessage(null);
    try {
      const res = await fetch("/api/channels/ebay/refresh", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMessage((data as { error?: string }).error ?? "eBay refresh failed");
      } else {
        setActionMessage("Refreshed from eBay.");
        await refreshLinks();
      }
    } catch {
      setActionMessage("eBay refresh failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runEbayFixCondition() {
    if (!storeItemId) return;
    setBusyAction("ebay-fix");
    setActionMessage(null);
    try {
      const res = await fetch("/api/channels/ebay/fix-condition", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId }),
      });
      const data = await res.json();
      if (!res.ok || !(data as { ok?: boolean }).ok) {
        setActionMessage((data as { error?: string }).error ?? "Could not fix eBay condition");
      } else {
        setActionMessage("eBay condition updated.");
        await refreshLinks();
        onFixEbayCondition?.();
      }
    } catch {
      setActionMessage("Could not fix eBay condition.");
    } finally {
      setBusyAction(null);
    }
  }

  if (!hasConnections && links.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <p className="mb-2">No connected stores yet.</p>
        <Link href="/seller-hub/channels" className="text-[var(--color-primary)] font-medium hover:underline">
          Connect stores in Sync Stores →
        </Link>
      </div>
    );
  }

  const hasLinks = links.length > 0;

  return (
    <div className="space-y-3">
      {hasLinks ? (
        <ul className="space-y-2">
          {links.map((link) => {
            const label = CHANNEL_PROVIDER_LABELS[link.provider] ?? providerLabel(link.provider);
            const { tone, text } = linkStatusLabel(link);
            const needsConditionFix =
              link.provider === "ebay" &&
              link.syncStatus === "error" &&
              isEbayConditionSyncError(link.syncError);
            const pushed = formatRelativeTime(link.lastPushedAt);

            return (
              <li
                key={link.provider}
                className={`rounded-lg border px-3 py-2 text-xs ${toneClass[tone]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{label}</span>
                  {pushed ? <span className="text-[10px] opacity-70 shrink-0">{pushed}</span> : null}
                </div>
                <p className="mt-0.5 break-words">{needsConditionFix ? `${text} · Fix condition` : text}</p>
                {needsConditionFix ? (
                  <button
                    type="button"
                    disabled={disabled || busyAction !== null}
                    onClick={() => void runEbayFixCondition()}
                    className="mt-1.5 underline font-medium hover:no-underline disabled:opacity-50"
                  >
                    {busyAction === "ebay-fix" ? "Fixing…" : "Fix eBay condition"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-gray-600">
          After you save, you can publish this listing to connected stores.
        </p>
      )}

      {storeItemId && hasLinks ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled || busyAction !== null}
            onClick={() => void runSyncNow()}
            className="action-pill action-pill-sm btn-pill-outline text-xs disabled:opacity-50"
          >
            {busyAction === "sync" ? "Syncing…" : "Sync now"}
          </button>
          {links.some((l) => l.provider === "wix") ? (
            <a
              href={`/api/channels/wix/diagnose?storeItemId=${encodeURIComponent(storeItemId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="action-pill action-pill-sm btn-pill-ghost text-xs"
            >
              Diagnose Wix
            </a>
          ) : null}
          {links.some((l) => l.provider === "ebay") ? (
            <button
              type="button"
              disabled={disabled || busyAction !== null}
              onClick={() => void runEbayRefresh()}
              className="action-pill action-pill-sm btn-pill-ghost text-xs disabled:opacity-50"
            >
              {busyAction === "ebay-refresh" ? "Refreshing…" : "Refresh from eBay"}
            </button>
          ) : null}
        </div>
      ) : null}

      {storeItemId && hasLinks ? (
        <div className="space-y-1">
          <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-700">
            <input
              type="checkbox"
              checked={skipSyncOnSave}
              onChange={(e) => onSkipSyncChange(e.target.checked)}
              className="rounded mt-0.5"
            />
            <span>
              <span className="font-medium text-gray-900">Save on INW only</span>
              <span className="block text-gray-500 mt-0.5">
                Don&apos;t update Wix, eBay, Etsy, or Shopify on this save. Your connected stores stay
                linked for the next update.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {actionMessage ? (
        <p className="text-xs text-gray-700 bg-gray-50 rounded px-2 py-1">{actionMessage}</p>
      ) : null}
    </div>
  );
}
