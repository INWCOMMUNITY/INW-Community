"use client";

import { useState } from "react";
import Link from "next/link";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL ?? "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

async function seedSiteContent(): Promise<{ pageId: string; sections: number }[]> {
  const res = await fetch(`${MAIN_URL}/api/admin/seed-site-content`, {
    method: "POST",
    headers: { "x-admin-code": ADMIN_CODE },
  });
  if (!res.ok) throw new Error("Seed failed");
  const data = await res.json();
  return data?.seeded ?? [];
}

// Editable pages only (storefront, support-local, coupons are non-editable)
const EDITABLE_PAGES = [
  { id: "home", label: "Home", path: "/" },
  { id: "about", label: "About", path: "/about" },
  { id: "sponsor-hub", label: "Sponsor Hub", path: "/sponsor-hub" },
  { id: "my-community", label: "My Community", path: "/my-community" },
  { id: "calendars", label: "Calendars", path: "/calendars" },
  { id: "subscribe", label: "Support NWC", path: "/subscribe" },
];

export default function EditorModePage() {
  const [page, setPage] = useState(EDITABLE_PAGES[0]);
  const [gridlines, setGridlines] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const iframeSrc = `${MAIN_URL}/editor?page=${encodeURIComponent(page.id)}&token=${encodeURIComponent(ADMIN_CODE)}`;

  async function handleSeed() {
    setSeeding(true);
    try {
      const seeded = await seedSiteContent();
      if (seeded.length > 0) {
        window.location.reload();
      }
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <label className="font-medium">Page:</label>
        <select
          value={page.id}
          onChange={(e) => {
            const p = EDITABLE_PAGES.find((x) => x.id === e.target.value);
            if (p) setPage(p);
          }}
          className="border rounded px-3 py-2"
        >
          {EDITABLE_PAGES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={gridlines}
            onChange={(e) => setGridlines(e.target.checked)}
          />
          Gridlines
        </label>
        <button
          type="button"
          onClick={handleSeed}
          disabled={seeding}
          className="rounded px-3 py-2 text-sm border bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          {seeding ? "Initializing…" : "Initialize content for all pages"}
        </button>
        <span className="text-sm text-gray-500">
          Editor tools are in the iframe below. Undo, Redo, Add section, Save, and design controls are in the main site editor. Changes are not public until you click Save.
        </span>
        <Link
          href="/dashboard"
          className="ml-auto rounded px-4 py-2 text-sm"
          style={{ backgroundColor: "#505542", color: "#fff" }}
        >
          Back to Dashboard
        </Link>
      </div>
      <div className="flex-1 border rounded-lg overflow-hidden bg-white relative">
        {gridlines && (
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              backgroundImage: `
                linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)
              `,
              backgroundSize: "20px 20px",
            }}
          />
        )}
        <iframe
          src={iframeSrc}
          title="Editor"
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
      <p className="text-sm text-gray-500 mt-2">
        Editor mode: open the main site in the frame above. Changes are not public until you save from the editor overlay on the main site.
      </p>
    </div>
  );
}
