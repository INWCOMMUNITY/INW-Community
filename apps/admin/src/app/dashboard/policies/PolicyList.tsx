"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

const DEFAULT_POLICIES = [
  { slug: "terms", title: "Terms of Service" },
  { slug: "privacy", title: "Privacy Policy" },
  { slug: "refunds", title: "Refund Policy" },
];

interface PolicyRow {
  id: string;
  slug: string;
  title: string;
  updatedAt: string;
}

export function PolicyList() {
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/policies`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => setPolicies(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading…</p>;

  const slugs = new Set(policies.map((p) => p.slug));
  const toShow = [
    ...policies,
    ...DEFAULT_POLICIES.filter((d) => !slugs.has(d.slug)).map((d) => ({ id: "", slug: d.slug, title: d.title, updatedAt: "" })),
  ];

  return (
    <ul className="space-y-2">
      {toShow.map((p) => (
        <li key={p.slug} className="flex items-center justify-between border rounded p-3">
          <span className="font-medium">{p.title}</span>
          <Link
            href={`/dashboard/policies/${p.slug}`}
            className="hover:underline text-sm"
            style={{ color: "#505542" }}
          >
            Edit
          </Link>
        </li>
      ))}
    </ul>
  );
}
