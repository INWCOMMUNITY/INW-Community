"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

const TITLES: Record<string, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  refunds: "Refund Policy",
};

export function PolicyEditor({ slug }: { slug: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(TITLES[slug] ?? slug);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/policies/${slug}`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.title) setTitle(data.title);
        if (data?.content) setContent(data.content);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/policies/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-code": ADMIN_CODE },
        body: JSON.stringify({ title, content }),
      });
      if (res.ok) router.push("/dashboard/policies");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/policies" className="text-sm hover:underline mb-4 inline-block" style={{ color: "#505542" }}>
        ← Back to Policies
      </Link>
      <h2 className="text-xl font-bold mb-4">Edit: {title}</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="w-full border rounded px-3 py-2 font-mono text-sm"
            placeholder="Plain text or markdown…"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: "#505542", color: "#fff" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
