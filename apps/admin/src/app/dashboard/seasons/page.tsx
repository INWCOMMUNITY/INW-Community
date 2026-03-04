"use client";

import { useState, useEffect } from "react";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface Season {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

export default function SeasonsAdminPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const headers = { "x-admin-code": ADMIN_CODE };

  const load = () => {
    setLoading(true);
    setError("");
    fetch(`${MAIN_URL}/api/admin/seasons`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSeasons(data);
        else setSeasons([]);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(), []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newStart || !newEnd) {
      setError("Name, start date, and end date required");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/seasons`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: newName.trim(), startDate: newStart, endDate: newEnd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to create");
        return;
      }
      setNewName("");
      setNewStart("");
      setNewEnd("");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: string) {
    if (!editName.trim() || !editStart || !editEnd) return;
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/seasons/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ name: editName.trim(), startDate: editStart, endDate: editEnd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update");
        return;
      }
      setEditingId(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this season? Member season points for this season will be removed.")) return;
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/seasons/${id}`, { method: "DELETE", headers });
      if (!res.ok) setError("Failed to delete");
      else load();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: Season) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditStart(s.startDate);
    setEditEnd(s.endDate);
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Seasons</h1>
      <p className="text-gray-600 mb-6">
        Seasons define the time windows for point-earning and the leaderboard. The leaderboard shows
        top earners for the current season (where today falls between start and end date). Create one
        season per competition period (e.g. Season 1: 3 months).
      </p>

      <form onSubmit={handleCreate} className="mb-8 p-4 border rounded-lg bg-gray-50 max-w-xl">
        <h2 className="text-lg font-semibold mb-3">Add season</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Season 1"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Start date</label>
            <input
              type="date"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">End date</label>
            <input
              type="date"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: "#505542", color: "#fff" }}
        >
          {saving ? "Adding…" : "Add season"}
        </button>
      </form>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="space-y-3 max-w-2xl">
        {seasons.length === 0 ? (
          <p className="text-gray-500">No seasons yet. Add one above.</p>
        ) : (
          seasons.map((s) => (
            <div key={s.id} className="border rounded-lg p-4 bg-white flex items-center justify-between gap-4">
              {editingId === s.id ? (
                <>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="border rounded px-2 py-1"
                    />
                    <input
                      type="date"
                      value={editStart}
                      onChange={(e) => setEditStart(e.target.value)}
                      className="border rounded px-2 py-1"
                    />
                    <input
                      type="date"
                      value={editEnd}
                      onChange={(e) => setEditEnd(e.target.value)}
                      className="border rounded px-2 py-1"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleUpdate(s.id)}
                      disabled={saving}
                      className="rounded px-3 py-1 text-sm bg-green-700 text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded px-3 py-1 text-sm border"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-gray-600 ml-2 text-sm">
                      {s.startDate} – {s.endDate}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(s)}
                      className="rounded px-3 py-1 text-sm border"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={saving}
                      className="rounded px-3 py-1 text-sm text-red-700 border border-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
