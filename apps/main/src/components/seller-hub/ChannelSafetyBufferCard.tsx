"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SyncPrefs = { safetyBuffer: number };

export function ChannelSafetyBufferCard() {
  const [buffer, setBuffer] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/seller/sync-preferences", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as SyncPrefs;
      setBuffer(data.safetyBuffer ?? 0);
    } catch {
      setBuffer(0);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: number) => {
    const value = Math.max(0, Math.min(10000, next));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/seller/sync-preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ safetyBuffer: value }),
      });
      if (!res.ok) {
        setError("Could not save safety buffer.");
        return;
      }
      const data = (await res.json()) as SyncPrefs;
      setBuffer(data.safetyBuffer);
    } catch {
      setError("Could not save safety buffer.");
    } finally {
      setSaving(false);
    }
  };

  if (buffer == null) return null;

  return (
    <div className="rounded-xl border-2 border-[var(--color-primary)] p-4 sm:p-5 bg-white">
      <h2 className="text-lg font-bold mb-2">Safety buffer</h2>
      <p className="text-sm text-gray-600 mb-3">
        INW always shows your real quantity. This number is how many units to{" "}
        <strong className="font-semibold text-gray-800">hold back</strong> on eBay, Etsy, and other
        connected stores. Example: 2 in stock and a buffer of 1 means those stores show 1. That
        extra unit is a cushion if someone buys on INW and on another store at the same time,
        before quantities catch up.
      </p>
      <p className="text-sm text-gray-600 mb-4">
        A buffer of 0 advertises every unit everywhere. A sale on two stores at once can still
        happen; NWC is not responsible for that. Using Sync Stores means you accept that risk. See
        our{" "}
        <Link href="/terms" className="underline text-[var(--color-primary)]">
          Terms of Service
        </Link>{" "}
        (Sales Channel Sync).
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="w-9 h-9 rounded-full border border-gray-300 bg-gray-50 text-lg leading-none disabled:opacity-40"
          disabled={saving || buffer <= 0}
          onClick={() => void save(buffer - 1)}
          aria-label="Decrease safety buffer"
        >
          −
        </button>
        <span className="min-w-[2ch] text-center text-lg font-semibold tabular-nums">{buffer}</span>
        <button
          type="button"
          className="w-9 h-9 rounded-full border border-gray-300 bg-gray-50 text-lg leading-none disabled:opacity-40"
          disabled={saving}
          onClick={() => void save(buffer + 1)}
          aria-label="Increase safety buffer"
        >
          +
        </button>
        <span className="text-sm text-gray-500">units held back on other stores</span>
      </div>
      {error ? <p className="text-sm text-red-700 mt-2">{error}</p> : null}
    </div>
  );
}
