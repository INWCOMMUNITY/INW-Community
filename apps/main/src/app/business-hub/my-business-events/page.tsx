"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type InviteStats = {
  sent: number;
  attending: number;
  maybe: number;
  declined: number;
};

type BusinessEventRow = {
  id: string;
  title: string;
  slug: string;
  dateStr: string;
  timeStr: string | null;
  calendarLabel: string;
  business: { name: string; slug: string } | null;
  inviteStats: InviteStats;
};

function StatBlock({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center aspect-square min-w-0 flex-1 rounded-lg p-2 text-center"
      style={{ backgroundColor: "var(--color-section-alt, #FDEDCC)" }}
    >
      <span className="text-lg font-bold text-gray-900">{value}</span>
      <span className="text-[10px] font-semibold text-gray-600 leading-tight mt-0.5">{label}</span>
    </div>
  );
}

function InviteStatsRow({ stats }: { stats: InviteStats }) {
  return (
    <div className="flex gap-2 mt-3 w-full">
      <StatBlock label="Invites" value={stats.sent} />
      <StatBlock label="Going" value={stats.attending} />
      <StatBlock label="Maybe" value={stats.maybe} />
      <StatBlock label="Can't go" value={stats.declined} />
    </div>
  );
}

export default function MyBusinessEventsPage() {
  const [events, setEvents] = useState<BusinessEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/me/business-events", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      setEvents([]);
      setError("Could not load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeEvent(id: string, title: string) {
    if (!globalThis.confirm(`Delete “${title}”? This cannot be undone.`)) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Delete failed");
      }
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href="/business-hub/manage"
        className="text-sm text-gray-600 hover:underline mb-4 inline-block"
      >
        ← Manage NWC Business
      </Link>
      <h1 className="text-2xl font-bold mb-2">My Business Events</h1>
      <p className="text-gray-600 mb-6">
        Calendar events posted as your business. View the public listing, see invite activity, or remove
        an event. To edit details, use the Northwest Community app (My Business Events or My Events).
      </p>
      {error ? <p className="text-red-600 text-sm mb-4">{error}</p> : null}
      {loading ? (
        <p className="text-gray-600">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-gray-600">
          No business events yet. Post from the{" "}
          <Link href="/business-hub" className="underline" style={{ color: "var(--color-link)" }}>
            Business Hub
          </Link>{" "}
          or the app calendar.
        </p>
      ) : (
        <ul className="space-y-6">
          {events.map((e) => (
            <li
              key={e.id}
              className="border rounded-xl p-4 flex flex-col gap-2"
              style={{ borderColor: "var(--color-primary, #0d6efd)" }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                  <Link
                    href={`/events/${e.slug}`}
                    className="font-semibold text-lg hover:underline"
                    style={{ color: "var(--color-link)" }}
                  >
                    {e.title}
                  </Link>
                  <p className="text-sm text-gray-600 mt-1">
                    <span
                      className="inline-block text-xs px-2 py-0.5 rounded mr-2"
                      style={{
                        backgroundColor: "var(--color-section-alt)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {e.calendarLabel}
                    </span>
                    {e.dateStr}
                    {e.timeStr ? ` · ${e.timeStr}` : ""}
                    {e.business ? ` · ${e.business.name}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-sm font-semibold text-red-600 hover:underline shrink-0 self-start disabled:opacity-50"
                  disabled={deletingId === e.id}
                  onClick={() => removeEvent(e.id, e.title)}
                >
                  {deletingId === e.id ? "Deleting…" : "Delete"}
                </button>
              </div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Invite activity
              </p>
              <InviteStatsRow stats={e.inviteStats} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
