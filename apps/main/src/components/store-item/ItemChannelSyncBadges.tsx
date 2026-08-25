"use client";

import Link from "next/link";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import { isEbayConditionSyncError } from "@/lib/channels/ebay/conditions";

export type ItemChannelLink = {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  syncError?: string | null;
  connectionStatus?: string | null;
  syncWarning?: string | null;
};

export function ItemChannelSyncBadges({
  links,
  storeItemId,
  compact = false,
}: {
  links: ItemChannelLink[];
  storeItemId: string;
  compact?: boolean;
}) {
  if (!links?.length) return null;

  return (
    <div className={compact ? "flex flex-wrap gap-1 mt-1" : "flex flex-col gap-1 mt-1.5"}>
      {links.map((link) => {
        const label = CHANNEL_PROVIDER_LABELS[link.provider] ?? link.provider;
        const warning = link.syncWarning?.trim() || null;
        const isConnectionIssue =
          link.connectionStatus === "error" || link.connectionStatus === "disconnected";
        const isError = Boolean(warning) && !isConnectionIssue;
        const isPaused = !warning && !link.syncEnabled;
        const needsConditionFix =
          link.provider === "ebay" && isError && isEbayConditionSyncError(link.syncError);

        const errorDetail = warning ?? (link.syncError?.trim() || "sync error");

        const text = compact
          ? warning
            ? `${isConnectionIssue ? "⚠ " : ""}${warning}`
            : isPaused
              ? `${label}: paused`
              : label
          : warning
            ? warning
            : isPaused
              ? `${label}: paused`
              : `Synced to ${label}`;

        const className = warning
          ? compact
            ? isConnectionIssue
              ? "text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
              : "text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-full px-2 py-0.5"
            : isConnectionIssue
              ? "text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-0.5"
              : "text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-0.5"
          : isPaused
            ? compact
              ? "text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5"
              : "text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-0.5"
            : compact
              ? "text-[11px] text-green-800 bg-green-50 border border-green-100 rounded-full px-2 py-0.5"
              : "text-xs text-green-800 bg-green-50 border border-green-100 rounded px-2 py-0.5";

        if (needsConditionFix) {
          return (
            <Link
              key={link.provider}
              href={`/seller-hub/store/${storeItemId}?fixEbayCondition=1`}
              className={`${className} hover:underline`}
              title={errorDetail}
            >
              {compact ? `${label}: fix condition` : `${text} · Tap to fix condition`}
            </Link>
          );
        }

        return (
          <span key={link.provider} className={className} title={warning ? errorDetail : undefined}>
            {text}
          </span>
        );
      })}
    </div>
  );
}
