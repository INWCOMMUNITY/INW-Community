"use client";

import { useState, useEffect } from "react";

interface MailingListEntry {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export default function AdminMailingListPage() {
  const [entries, setEntries] = useState<MailingListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/admin/mailing-list")
      .then((r) => r.json())
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.email.toLowerCase().includes(q) ||
      e.firstName.toLowerCase().includes(q) ||
      e.lastName.toLowerCase().includes(q)
    );
  });

  const copyEmails = () => {
    const list = filtered.map((e) => e.email).join("\n");
    void navigator.clipboard.writeText(list);
  };

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Mailing list</h1>
      <p className="text-gray-600 mb-6">
        Emails collected at sign up. All registered members are included.
      </p>
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name…"
          className="flex-1 min-w-[200px] border rounded px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={copyEmails}
          className="px-4 py-2 rounded text-sm font-medium bg-gray-800 text-white hover:bg-gray-700"
        >
          Copy emails
        </button>
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Signed up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2">{e.email}</td>
                <td className="px-4 py-2">
                  {e.firstName} {e.lastName}
                </td>
                <td className="px-4 py-2 text-sm text-gray-600">
                  {e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-500">No entries to show.</p>
        )}
      </div>
      <p className="mt-4 text-sm text-gray-500">
        {filtered.length} {filtered.length === 1 ? "email" : "emails"}
        {search.trim() ? " (filtered)" : ""}
      </p>
    </div>
  );
}
