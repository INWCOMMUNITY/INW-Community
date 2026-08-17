"use client";

import { formatChannelSyncResults, type ChannelSyncRow } from "@/lib/channel-sync-feedback";

type ChannelSyncResultBannerProps = {
  channelSync?: ChannelSyncRow[];
  action?: "saved" | "deleted" | "removed";
  onDismiss?: () => void;
};

export function ChannelSyncResultBanner({
  channelSync,
  action = "saved",
  onDismiss,
}: ChannelSyncResultBannerProps) {
  const result = formatChannelSyncResults(channelSync, action);
  if (!channelSync?.length || result.allOk) return null;

  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-left"
      role="alert"
    >
      <p className="text-sm font-semibold text-red-800 mb-2">{result.title}</p>
      <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
        {result.failureLines.map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-3 text-xs font-medium text-red-800 underline hover:no-underline"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
