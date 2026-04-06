"use client";

import { useState, useEffect } from "react";
import { AdminMemberActions } from "./AdminMemberActions";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

interface Member {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  city: string | null;
  status: string;
  createdAt: string;
  _count: { subscriptions: number };
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/members`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = members.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      m.email.toLowerCase().includes(q) ||
      m.firstName.toLowerCase().includes(q) ||
      m.lastName.toLowerCase().includes(q) ||
      (m.city ?? "").toLowerCase().includes(q)
    );
  });

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Members</h1>
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or city…"
          className="w-full max-w-md border rounded px-3 py-2 text-sm"
        />
      </div>
      <p className="text-sm text-gray-600 mb-3 max-w-2xl">
        Actions stay on the left. If a row is very wide, use the horizontal scrollbar under the table.
      </p>
      <div className="admin-x-scroll rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[220px]" />
            <col />
            <col />
            <col />
            <col className="w-[100px]" />
            <col className="w-[120px]" />
            <col className="w-[100px]" />
          </colgroup>
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 bg-gray-50 px-4 py-2 text-left text-xs font-medium uppercase text-gray-500 shadow-[4px_0_12px_-4px_rgba(0,0,0,0.12)]"
              >
                Actions
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">City</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Subs</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((m) => (
              <tr key={m.id}>
                <td className="sticky left-0 z-10 bg-white px-4 py-2 align-top shadow-[4px_0_12px_-4px_rgba(0,0,0,0.08)]">
                  <AdminMemberActions
                    memberId={m.id}
                    status={m.status}
                    onDeleted={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
                  />
                </td>
                <td className="px-4 py-2 break-all align-top">{m.firstName} {m.lastName}</td>
                <td className="px-4 py-2 break-all align-top">{m.email}</td>
                <td className="px-4 py-2 break-all align-top">{m.city ?? "—"}</td>
                <td className="px-4 py-2 align-top">
                  <span
                    className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
                      m.status === "suspended" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-2 align-top">{m._count.subscriptions}</td>
                <td className="px-4 py-2 text-sm text-gray-500 align-top whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
