"use client";

import { useEffect, useState } from "react";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import {
  channelNotReadyHint,
  connectionsForPublishModal,
  defaultSelectedProviders,
  fetchChannelConnections,
  publishReadyConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections-client";

type ChannelPublishModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (providers: ChannelProviderId[]) => void;
};

export function ChannelPublishModal({ open, onClose, onConfirm }: ChannelPublishModalProps) {
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<ChannelConnectionSummary[]>([]);
  const [selected, setSelected] = useState<Set<ChannelProviderId>>(new Set());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchChannelConnections()
      .then((list) => {
        const modalConnections = connectionsForPublishModal(list);
        setConnections(modalConnections);
        setSelected(new Set(defaultSelectedProviders(list)));
      })
      .catch(() => {
        setConnections([]);
        setSelected(new Set());
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const toggle = (provider: ChannelProviderId, disabled: boolean) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const hasPublishReady = publishReadyConnections(connections).length > 0;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-left"
        role="dialog"
        aria-labelledby="publish-modal-title"
      >
        <h2 id="publish-modal-title" className="text-lg font-bold text-gray-900 mb-1">
          Also list on connected stores?
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          Choose where to publish this listing. Only stores you connect in Sync Stores appear here.
        </p>

        {loading ? (
          <div className="py-6 flex justify-center">
            <span className="w-8 h-8 border-2 border-gray-200 border-t-[var(--color-primary)] rounded-full animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-gray-600 mb-4">
            No connected stores. This listing will only appear on INW.
          </p>
        ) : (
          <ul className="space-y-2 mb-4 max-h-56 overflow-y-auto">
            {connections.map((c) => {
              const provider = c.provider as ChannelProviderId;
              const disabled = c.status !== "active" || c.readyToPublish === false;
              const checked = selected.has(provider);
              const label = CHANNEL_PROVIDER_LABELS[c.provider] ?? c.provider;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(provider, disabled)}
                    className={`w-full flex items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      disabled
                        ? "border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed"
                        : checked
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
                          : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                        checked
                          ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-white"
                          : "border-gray-300"
                      }`}
                    >
                      {checked ? "✓" : ""}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{label}</span>
                      {disabled ? (
                        <span className="block text-xs text-gray-500 mt-0.5">
                          {c.status !== "active"
                            ? "Reconnect in Sync Stores."
                            : channelNotReadyHint(provider)}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={() => onConfirm([])}
            className="action-pill action-pill-sm btn-pill-outline flex-1 justify-center"
          >
            INW only
          </button>
          <button
            type="button"
            disabled={!hasPublishReady && selected.size > 0}
            onClick={() => onConfirm(Array.from(selected))}
            className="btn flex-1 disabled:opacity-50"
          >
            Publish selected
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-sm text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
