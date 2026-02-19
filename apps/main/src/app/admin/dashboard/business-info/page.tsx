"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface BusinessInfo {
  name?: string;
  description?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
}

interface TimeAway {
  enabled?: boolean;
  message?: string;
  startDate?: string;
  endDate?: string;
}

export default function AdminBusinessInfoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const [platform, setPlatform] = useState<BusinessInfo>({});
  const [admin, setAdmin] = useState<BusinessInfo>({});
  const [timeAway, setTimeAway] = useState<TimeAway>({});

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then((r) => r.json())
      .then((data) => {
        setPlatform((data.platform_business as BusinessInfo) ?? {});
        setAdmin((data.admin_business as BusinessInfo) ?? {});
        setTimeAway((data.time_away as TimeAway) ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function savePlatform() {
    setSaving("platform");
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "platform_business", value: platform }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(null);
    }
  }

  async function saveAdmin() {
    setSaving("admin");
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "admin_business", value: admin }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(null);
    }
  }

  async function saveTimeAway() {
    setSaving("time_away");
    try {
      const res = await fetch("/api/admin/site-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "time_away", value: timeAway }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold">Business Info</h1>

      {/* Platform Business (NWC platform) */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Platform Business (NW Community)</h2>
        <p className="text-sm text-gray-600 mb-4">Business info for the NW Community platform shown on the main site.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={platform.name ?? ""}
              onChange={(e) => setPlatform((p) => ({ ...p, name: e.target.value }))}
              className="w-full border rounded px-3 py-2"
              placeholder="NW Community"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={platform.description ?? ""}
              onChange={(e) => setPlatform((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              className="w-full border rounded px-3 py-2"
              placeholder="About the platform…"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Website</label>
            <input
              type="url"
              value={platform.website ?? ""}
              onChange={(e) => setPlatform((p) => ({ ...p, website: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input
              type="tel"
              value={platform.phone ?? ""}
              onChange={(e) => setPlatform((p) => ({ ...p, phone: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={platform.email ?? ""}
              onChange={(e) => setPlatform((p) => ({ ...p, email: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input
              type="text"
              value={platform.address ?? ""}
              onChange={(e) => setPlatform((p) => ({ ...p, address: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <button
            type="button"
            onClick={savePlatform}
            disabled={saving !== null}
            className="px-4 py-2 rounded disabled:opacity-50 text-sm"
            style={{ backgroundColor: "#505542", color: "#fff" }}
          >
            {saving === "platform" ? "Saving…" : "Save Platform Info"}
          </button>
        </div>
      </div>

      {/* Admin Personal Business */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">My Business (Admin Personal)</h2>
        <p className="text-sm text-gray-600 mb-4">Your personal business info – separate from the platform.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={admin.name ?? ""}
              onChange={(e) => setAdmin((a) => ({ ...a, name: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={admin.description ?? ""}
              onChange={(e) => setAdmin((a) => ({ ...a, description: e.target.value }))}
              rows={3}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Website</label>
            <input
              type="url"
              value={admin.website ?? ""}
              onChange={(e) => setAdmin((a) => ({ ...a, website: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input
              type="tel"
              value={admin.phone ?? ""}
              onChange={(e) => setAdmin((a) => ({ ...a, phone: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={admin.email ?? ""}
              onChange={(e) => setAdmin((a) => ({ ...a, email: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input
              type="text"
              value={admin.address ?? ""}
              onChange={(e) => setAdmin((a) => ({ ...a, address: e.target.value }))}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <button
            type="button"
            onClick={saveAdmin}
            disabled={saving !== null}
            className="px-4 py-2 rounded disabled:opacity-50 text-sm"
            style={{ backgroundColor: "#505542", color: "#fff" }}
          >
            {saving === "admin" ? "Saving…" : "Save My Business"}
          </button>
        </div>
      </div>

      {/* Time Away */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Time Away</h2>
        <p className="text-sm text-gray-600 mb-4">Show a message when you&apos;re away. The main site can display this to visitors.</p>
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={timeAway.enabled ?? false}
              onChange={(e) => setTimeAway((t) => ({ ...t, enabled: e.target.checked }))}
              className="rounded"
            />
            <span className="text-sm font-medium">Time away is active</span>
          </label>
          <div>
            <label className="block text-sm font-medium mb-1">Message</label>
            <textarea
              value={timeAway.message ?? ""}
              onChange={(e) => setTimeAway((t) => ({ ...t, message: e.target.value }))}
              rows={2}
              className="w-full border rounded px-3 py-2"
              placeholder="e.g. Away until Jan 15. Orders will ship when I return."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start date</label>
              <input
                type="date"
                value={timeAway.startDate ?? ""}
                onChange={(e) => setTimeAway((t) => ({ ...t, startDate: e.target.value }))}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End date</label>
              <input
                type="date"
                value={timeAway.endDate ?? ""}
                onChange={(e) => setTimeAway((t) => ({ ...t, endDate: e.target.value }))}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={saveTimeAway}
            disabled={saving !== null}
            className="px-4 py-2 rounded disabled:opacity-50 text-sm"
            style={{ backgroundColor: "#505542", color: "#fff" }}
          >
            {saving === "time_away" ? "Saving…" : "Save Time Away"}
          </button>
        </div>
      </div>
    </div>
  );
}
