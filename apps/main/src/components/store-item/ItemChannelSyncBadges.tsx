"use client";

import Link from "next/link";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import { isEbayConditionSyncError } from "@/lib/channels/ebay/conditions";

export type ItemChannelLink = {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  syncError?: string | null;
};

export function ItemChannelSyncBadges({
  links,
  storeItemId,
}: {
  links: ItemChannelLink[];
  storeItemId: string;
}) {
  if (!links?.length) return null;

  return (
    <div className="flex flex-col gap-1 mt-1.5">
      {links.map((link) => {
        const label = CHANNEL_PROVIDER_LABELS[link.provider] ?? link.provider;
        const isError = link.syncStatus === "error";
        const isPaused = !link.syncEnabled;
        const needsConditionFix =
          link.provider === "ebay" && isError && isEbayConditionSyncError(link.syncError);

        const text = isError
          ? `${label}: ${link.syncError?.trim() ? link.syncError.trim().slice(0, 120) : "sync error"}`
          : isPaused
            ? `${label}: paused`
            : `Synced to ${label}`;

        const className = isError
          ? "text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-0.5"
          : isPaused
            ? "text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-0.5"
            : "text-xs text-green-800 bg-green-50 border border-green-100 rounded px-2 py-0.5";

        if (needsConditionFix) {
          return (
            <Link
              key={link.provider}
              href={`/seller-hub/store/${storeItemId}?fixEbayCondition=1`}
              className={`${className} hover:underline`}
            >
              {text} · Tap to fix condition
            </Link>
          );
        }

        return (
          <span key={link.provider} className={className}>
            {text}
          </span>
        );
      })}
    </div>
  );
}
