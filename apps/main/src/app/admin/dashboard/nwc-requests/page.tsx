"use client";

import { useState, useEffect } from "react";

interface Row {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  createdAt: string;
  memberId: string | null;
  member: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

export default function NwcRequestsAdminPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/nwc-requests")
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">App support &amp; contact requests</h1>
      <p className="text-gray-600 mb-6 max-w-3xl">
        Messages sent from the mobile app (&quot;Support &amp; contact&quot;) and from the website NWC
        request form. Each row includes the sender&apos;s email so you can reply from your inbox.
        Nothing here depends on Resend—everything is stored when the user taps send.
      </p>
      {rows.length === 0 ? (
        <p className="text-gray-500">No requests yet.</p>
      ) : (
        <ul className="space-y-6">
          {rows.map((r) => (
            <li
              key={r.id}
              className="border rounded-lg p-4 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <p className="font-semibold text-gray-900">
                  {r.subject?.trim() ? r.subject : <span className="text-gray-500 font-normal">(no subject)</span>}
                </p>
                <time className="text-sm text-gray-500">
                  {new Date(r.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-gray-700 mb-1">
                <span className="font-medium">From:</span> {r.name}{" "}
                <a
                  className="underline"
                  style={{ color: "#505542" }}
                  href={`mailto:${encodeURIComponent(r.email)}?subject=${encodeURIComponent(`Re: ${r.subject || "NWC"}`)}`}
                >
                  {r.email}
                </a>
              </p>
              {r.phone?.trim() ? (
                <p className="text-sm text-gray-700 mb-1">
                  <span className="font-medium">Phone:</span>{" "}
                  <a className="underline" style={{ color: "#505542" }} href={`tel:${r.phone.replace(/\s/g, "")}`}>
                    {r.phone}
                  </a>
                </p>
              ) : null}
              {r.member ? (
                <p className="text-xs text-gray-500 mb-2">
                  Signed-in member: {r.member.firstName} {r.member.lastName} ({r.member.email}) · ID{" "}
                  {r.member.id}
                </p>
              ) : (
                <p className="text-xs text-gray-500 mb-2">Not signed in (or no member link)</p>
              )}
              <div className="mt-3 p-3 rounded bg-gray-50 text-sm text-gray-800 whitespace-pre-wrap">
                {r.message}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
