"use client";

import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import {
  activeListOnConnections,
  channelNotReadyHint,
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
  const active = activeListOnConnections(connections);
  if (active.length === 0) return null;

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
    <fieldset className="space-y-2">
      <legend className="sr-only">List on connected stores</legend>
      {active.map((c) => {
        const provider = c.provider;
        const blocked = c.readyToPublish === false;
        const reason = blocked
          ? c.publishBlockReason || channelNotReadyHint(provider)
          : null;
        const checked = !blocked && selected.includes(provider);
        const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
        return (
          <label
            key={c.id}
            className={`flex items-start gap-2 text-sm ${
              blocked || disabled ? "cursor-not-allowed text-gray-500" : "cursor-pointer text-gray-800"
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
              checked={checked}
              disabled={disabled || blocked}
              onChange={(e) => toggle(provider, e.target.checked, blocked)}
            />
            <span>
              <span className="font-medium">List on {label}</span>
              {c.shopName ? (
                <span className="block text-xs text-gray-500 font-normal">{c.shopName}</span>
              ) : null}
              {reason ? <span className="block text-xs text-gray-500 font-normal">{reason}</span> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
