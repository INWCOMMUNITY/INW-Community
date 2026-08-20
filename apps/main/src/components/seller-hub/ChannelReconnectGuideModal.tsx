"use client";

import { CHANNEL_RECONNECT_GUIDE_STEPS } from "@/lib/channels/channel-reconnect-guide";

type Props = {
  providerName: string;
  reconnectHref: string;
  reconnectDisabled?: boolean;
  onDismiss: () => void;
};

export function ChannelReconnectGuideModal({
  providerName,
  reconnectHref,
  reconnectDisabled = false,
  onDismiss,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-reconnect-guide-title"
    >
      <div className="w-full max-w-md rounded-xl border-2 border-[var(--color-primary)] bg-white p-5 shadow-xl">
        <h2 id="channel-reconnect-guide-title" className="text-lg font-bold mb-2">
          Reconnect {providerName}
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          {providerName} sync paused. Follow these steps to turn it back on.
        </p>
        <ol className="list-decimal pl-5 space-y-2.5 text-sm text-gray-700 mb-6">
          {CHANNEL_RECONNECT_GUIDE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            I&apos;ll do this later
          </button>
          {reconnectDisabled ? (
            <button
              type="button"
              disabled
              className="rounded-lg border-2 border-[var(--color-primary)] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white opacity-50"
            >
              Enter your Shopify domain first
            </button>
          ) : (
            <a
              href={reconnectHref}
              className="rounded-lg border-2 border-[var(--color-primary)] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white text-center hover:opacity-90"
            >
              Reconnect {providerName}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
