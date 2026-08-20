"use client";

import Link from "next/link";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import {
  channelNotReadyHint,
  listOnConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections-client";

type ChannelListOnCheckboxesProps = {
  connections: ChannelConnectionSummary[];
  selected: ChannelProviderId[];
  onChange: (next: ChannelProviderId[]) => void;
  disabled?: boolean;
};

export function ChannelListOnCheckboxes({
  connections,
  selected,
  onChange,
  disabled,
}: ChannelListOnCheckboxesProps) {
  const rows = listOnConnections(connections);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No connected stores yet.{" "}
        <Link
          href="/seller-hub/channels"
          className="font-medium text-[var(--color-primary)] hover:underline"
        >
          Connect stores in Sync Stores
        </Link>
      </p>
    );
  }

  function toggle(provider: ChannelProviderId, checked: boolean, blocked: boolean) {
    if (blocked) return;
    if (checked) {
      if (selected.includes(provider)) return;
      onChange([...selected, provider]);
      return;
    }
    onChange(selected.filter((p) => p !== provider));
  }

  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">Also list on connected stores</legend>
      {rows.map((c) => {
        const provider = c.provider;
        const needsReconnect = c.status === "error";
        const blocked = needsReconnect || c.readyToPublish === false;
        const reason = blocked
          ? c.publishBlockReason || channelNotReadyHint(provider)
          : null;
        const checked = !blocked && selected.includes(provider);
        const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
        return (
          <label
            key={c.id}
            className={`flex items-start gap-2.5 text-sm ${
              blocked || disabled ? "cursor-not-allowed text-gray-500" : "cursor-pointer text-gray-800"
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
              checked={checked}
              disabled={disabled || blocked}
              onChange={(e) => toggle(provider, e.target.checked, blocked)}
            />
            <span>
              <span className="font-medium text-gray-900">List on {label}</span>
              {c.shopName ? (
                <span className="block text-xs text-gray-500 font-normal">{c.shopName}</span>
              ) : null}
              {reason ? (
                <span className="block text-xs text-gray-500 font-normal mt-0.5">{reason}</span>
              ) : null}
              {needsReconnect ? (
                <Link
                  href="/seller-hub/channels"
                  className="inline-block mt-1 text-xs font-medium text-[var(--color-primary)] hover:underline"
                >
                  Reconnect in Sync Stores
                </Link>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
