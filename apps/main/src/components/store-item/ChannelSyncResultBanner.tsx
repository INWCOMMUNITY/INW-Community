"use client";

import { formatChannelSyncResults, providerLabel, type ChannelSyncRow } from "@/lib/channel-sync-feedback";

type ChannelSyncResultBannerProps = {
  channelSync?: ChannelSyncRow[];
  action?: "saved" | "deleted" | "removed";
  onDismiss?: () => void;
  onRetryFailed?: () => void;
  retrying?: boolean;
};

export function ChannelSyncResultBanner({
  channelSync,
  action = "saved",
  onDismiss,
  onRetryFailed,
  retrying,
}: ChannelSyncResultBannerProps) {
  const result = formatChannelSyncResults(channelSync, action);
  if (!channelSync?.length || result.allOk) return null;

  const mixed = result.succeeded.length > 0;
  const wrapClass = mixed
    ? "rounded-lg border border-amber-200 bg-amber-50 p-4 text-left"
    : "rounded-lg border border-red-200 bg-red-50 p-4 text-left";
  const titleClass = mixed ? "text-sm font-semibold text-amber-900 mb-2" : "text-sm font-semibold text-red-800 mb-2";
  const bodyClass = mixed ? "text-sm text-amber-950" : "text-sm text-red-700";
  const failedLabels = result.failed.map((r) => providerLabel(r.provider));
  const retryLabel =
    failedLabels.length === 1 ? `Retry ${failedLabels[0]}` : `Retry ${failedLabels.join(", ")}`;

  return (
    <div className={wrapClass} role="alert">
      <p className={titleClass}>{result.title}</p>
      {result.successLines.length > 0 ? (
        <p className={`${bodyClass} mb-2`}>
          Listed on {result.successLines.join(", ")}. This item is saved on INW — do not list it again
          from scratch.
        </p>
      ) : (
        <p className={`${bodyClass} mb-2`}>
          Saved on INW. Retry the failed store(s) from this page so you do not create a duplicate listing.
        </p>
      )}
      <ul className={`${bodyClass} space-y-1 list-disc list-inside`}>
        {result.failureLines.map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {onRetryFailed ? (
          <button
            type="button"
            onClick={onRetryFailed}
            disabled={retrying}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {retrying ? "Retrying…" : retryLabel}
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className={`text-xs font-medium underline hover:no-underline ${mixed ? "text-amber-900" : "text-red-800"}`}
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}
