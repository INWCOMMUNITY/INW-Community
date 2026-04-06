"use client";

import { useState, useEffect } from "react";
import { AdminMemberActions } from "./AdminMemberActions";

interface Member {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  city: string | null;
  status: string;
  createdAt: string;
  _count: { subscriptions: number; businesses?: number };
}

interface BusinessOption {
  id: string;
  name: string;
  slug: string;
  memberId: string;
  member?: { firstName: string; lastName: string; email: string };
  adminGrantedAt: string | null;
}

export default function AdminMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [assignForMember, setAssignForMember] = useState<Member | null>(null);
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [assignBusinessId, setAssignBusinessId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assignLoadingBiz, setAssignLoadingBiz] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState<{
    businessName: string;
    memberLabel: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/admin/members")
      .then((r) => r.json())
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!assignForMember) {
      setBusinesses([]);
      setAssignBusinessId("");
      setAssignError("");
      return;
    }
    setAssignLoadingBiz(true);
    fetch("/api/admin/businesses")
      .then((r) => r.json())
      .then((data) => setBusinesses(Array.isArray(data) ? data : []))
      .catch(() => setBusinesses([]))
      .finally(() => {
        setAssignLoadingBiz(false);
        setAssignBusinessId("");
      });
  }, [assignForMember]);

  async function handleAssignBusiness() {
    if (!assignForMember || !assignBusinessId) return;
    setAssignError("");
    setAssigning(true);
    const chosen =
      businesses.find((b) => b.id === assignBusinessId)?.name ?? "Business";
    const memberLabel = `${assignForMember.firstName} ${assignForMember.lastName} (${assignForMember.email})`;
    try {
      const res = await fetch(`/api/admin/businesses/${assignBusinessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: assignForMember.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAssignError(data.error ?? "Failed to assign");
        return;
      }
      setAssignSuccess({ businessName: chosen, memberLabel });
      setAssignForMember(null);
      setAssignBusinessId("");
    } finally {
      setAssigning(false);
    }
  }

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
        Actions stay pinned on the left. A horizontal scrollbar appears under the table when this panel is under
        about 1200px wide (site layout uses overflow-x hidden, so scrolling is inside this box).
      </p>
      <div className="admin-x-scroll rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-[max(100%,1200px)] table-fixed divide-y divide-gray-200">
          <colgroup>
            <col className="w-[260px]" />
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
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setAssignForMember(m)}
                      className="w-fit text-sm px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
                    >
                      Assign business
                    </button>
                    <AdminMemberActions
                      memberId={m.id}
                      status={m.status}
                      onDeleted={() => setMembers((prev) => prev.filter((x) => x.id !== m.id))}
                    />
                  </div>
                </td>
                <td className="px-4 py-2 break-all align-top">
                  {m.firstName} {m.lastName}
                </td>
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

      {assignSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-success-title"
          onClick={(e) => e.target === e.currentTarget && setAssignSuccess(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="assign-success-title" className="text-lg font-semibold mb-2 text-green-800">
              Business assigned
            </h2>
            <p className="text-sm text-gray-700 mb-4">
              <span className="font-medium">{assignSuccess.businessName}</span> is now linked to{" "}
              <span className="font-medium">{assignSuccess.memberLabel}</span>. They have Business Hub access
              (no payment required).
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAssignSuccess(null)}
                className="px-3 py-1.5 text-sm rounded text-white"
                style={{ backgroundColor: "#505542" }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {assignForMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => e.target === e.currentTarget && setAssignForMember(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2">Assign business to member</h2>
            <p className="text-sm text-gray-600 mb-3">
              {assignForMember.firstName} {assignForMember.lastName} ({assignForMember.email}) will get free Business Hub access.
            </p>
            {assignLoadingBiz ? (
              <p className="text-gray-500 text-sm">Loading businesses…</p>
            ) : (
              <>
                <label className="block text-sm font-medium mb-1">Business</label>
                <select
                  value={assignBusinessId}
                  onChange={(e) => setAssignBusinessId(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm mb-3"
                >
                  <option value="">— Select business —</option>
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.member ? ` (current: ${b.member.firstName} ${b.member.lastName})` : ""}
                    </option>
                  ))}
                </select>
                {assignError && <p className="text-red-600 text-sm mb-2">{assignError}</p>}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setAssignForMember(null)}
                    className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAssignBusiness}
                    disabled={!assignBusinessId || assigning}
                    className="px-3 py-1.5 text-sm rounded disabled:opacity-50 text-white"
                    style={{ backgroundColor: "#505542" }}
                  >
                    {assigning ? "Assigning…" : "Assign"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
