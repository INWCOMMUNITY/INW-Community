"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

export function DashboardQuote() {
  const router = useRouter();
  const [quote, setQuote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/site-settings?key=quoteOfTheWeek`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => {
        if (typeof data === "string") setQuote(data);
        else if (data?.text) setQuote(data.text);
        else setQuote("");
      })
      .catch(() => setQuote(""))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/site-settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
        body: JSON.stringify({
          key: "quoteOfTheWeek",
          value: { text: quote },
        }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500 text-sm">Loading…</p>;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Quote of the Week
      </label>
      <textarea
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
        placeholder="Enter quote of the week…"
        rows={3}
        className="w-full border rounded px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded px-4 py-2 text-sm disabled:opacity-50"
        style={{ backgroundColor: "#505542", color: "#fff" }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
