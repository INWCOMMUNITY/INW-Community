"use client";

import { useState } from "react";

/** Matches the mobile ChannelSettingsModal options and the /api/channels/:id/config values. */
const SYNC_DIRECTION_OPTIONS: { value: string; label: string; desc: string }[] = [
  { value: "two_way", label: "Two-way Sync", desc: "Changes sync in both directions" },
  { value: "push_only", label: "Push Only", desc: "INW changes push to this store, never pull" },
  { value: "pull_only", label: "Pull Only", desc: "This store's changes pull to INW, never push" },
  { value: "paused", label: "Paused", desc: "No syncing with this store until re-enabled" },
];

export function ChannelSyncDirectionControl({
  connectionId,
  providerName,
  current,
  onChanged,
}: {
  connectionId: string;
  providerName: string;
  current: string;
  onChanged?: (next: string) => void;
}) {
  // Optimistic local value so the selection reflects immediately while the PATCH is in flight.
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const select = async (next: string) => {
    if (next === value || saving) return;
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/channels/${connectionId}/config`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncDirection: next }),
      });
      if (!res.ok) {
        setValue(prev);
        setError(`Could not update ${providerName} sync direction.`);
        return;
      }
      const data = (await res.json()) as { syncDirection?: string };
      const applied = data.syncDirection ?? next;
      setValue(applied);
      onChanged?.(applied);
    } catch {
      setValue(prev);
      setError(`Could not update ${providerName} sync direction.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-semibold text-gray-800 mb-1">Sync direction</p>
      <p className="text-xs text-gray-500 mb-3">
        Control which way changes flow between INW and {providerName}. Use{" "}
        <strong className="font-semibold">Paused</strong> to fully isolate this store.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label={`${providerName} sync direction`}>
        {SYNC_DIRECTION_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={saving}
              onClick={() => void select(opt.value)}
              className={`text-left rounded-lg border-2 p-2.5 transition-colors disabled:opacity-60 ${
                active
                  ? "border-[var(--color-primary)] bg-gray-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <span
                className={`flex items-center gap-1.5 text-sm font-semibold ${
                  active ? "text-[var(--color-primary)]" : "text-gray-800"
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-block w-3.5 h-3.5 rounded-full border-2 ${
                    active ? "border-[var(--color-primary)]" : "border-gray-300"
                  }`}
                  style={active ? { backgroundColor: "var(--color-primary)" } : undefined}
                />
                {opt.label}
              </span>
              <span className="block text-xs text-gray-500 mt-0.5 pl-5">{opt.desc}</span>
            </button>
          );
        })}
      </div>
      {error ? <p className="text-xs text-red-700 mt-2">{error}</p> : null}
    </div>
  );
}
