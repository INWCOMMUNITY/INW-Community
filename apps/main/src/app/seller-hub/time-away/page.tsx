"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type TimeAwayState = {
  timeAway: {
    id: string;
    startAt: string;
    endAt: string;
    allowSalesThrough: string;
    isActive: boolean;
    itemsHidden: boolean;
  } | null;
} | null;

export default function TimeAwayPage() {
  const [data, setData] = useState<TimeAwayState>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");

  useEffect(() => {
    fetch("/api/seller-hub/time-away")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d?.timeAway) {
          setStartAt(d.timeAway.startAt.slice(0, 16));
          setEndAt(d.timeAway.endAt.slice(0, 16));
        }
      })
      .catch(() => setData({ timeAway: null }))
      .finally(() => setLoading(false));
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    fetch("/api/seller-hub/time-away", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        return fetch("/api/seller-hub/time-away").then((res) => res.json());
      })
      .then((d) => {
        if (d?.timeAway) {
          setData(d);
          setStartAt(d.timeAway.startAt.slice(0, 16));
          setEndAt(d.timeAway.endAt.slice(0, 16));
        }
      })
      .finally(() => setSaving(false));
  }

  function handleClear() {
    setSaving(true);
    fetch("/api/seller-hub/time-away", { method: "DELETE" })
      .then(() => {
        setData({ timeAway: null });
        setStartAt("");
        setEndAt("");
      })
      .finally(() => setSaving(false));
  }

  if (loading) {
    return (
      <div>
        <Link href="/seller-hub" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Seller Hub
        </Link>
        <p className="text-gray-600">Loading…</p>
      </div>
    );
  }

  const t = data?.timeAway;

  return (
    <div>
      <Link href="/seller-hub" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
        ← Seller Hub
      </Link>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--color-heading)" }}>
        Time Away
      </h1>
      <p className="text-gray-600 mb-6">
        Set dates when you’re away. Your storefront can still allow sales for up to 14 days after your start date.
        If your time away is longer than that, your items will be temporarily hidden from the storefront until your return date.
      </p>

      {t && (
        <div
          className="mb-6 p-4 rounded-lg border-2"
          style={{ backgroundColor: "var(--color-section-alt)", borderColor: "var(--color-primary)" }}
        >
          <p className="font-medium mb-1">Current time away</p>
          <p className="text-sm text-gray-700">
            {new Date(t.startAt).toLocaleDateString()} – {new Date(t.endAt).toLocaleDateString()}
          </p>
          <p className="text-sm text-gray-600 mt-1">
            Sales allowed through {new Date(t.allowSalesThrough).toLocaleDateString()}.
            {t.itemsHidden && " Your items are temporarily hidden from the storefront."}
            {t.isActive && !t.itemsHidden && " Your storefront shows you’re away but items are still for sale."}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label htmlFor="startAt" className="block text-sm font-medium text-gray-700 mb-1">
            Start date
          </label>
          <input
            id="startAt"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
            required
          />
        </div>
        <div>
          <label htmlFor="endAt" className="block text-sm font-medium text-gray-700 mb-1">
            End date (return date)
          </label>
          <input
            id="endAt"
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Saving…" : t ? "Update time away" : "Set time away"}
          </button>
          {t && (
            <button
              type="button"
              onClick={handleClear}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100"
              disabled={saving}
            >
              Clear time away
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
