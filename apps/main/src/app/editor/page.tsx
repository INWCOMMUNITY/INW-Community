"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const BlockEditor = dynamic(() => import("@/components/editor/BlockEditor").then((m) => ({ default: m.BlockEditor })), {
  ssr: false,
  loading: () => <div className="min-h-[400px] flex items-center justify-center text-gray-500">Loading editor…</div>,
});

// Editable pages only (storefront, support-local, coupons are non-editable)
const EDITABLE_PAGES = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "sponsor-hub", label: "Sponsor Hub" },
  { id: "my-community", label: "My Community" },
  { id: "calendars", label: "Calendars" },
  ];

function EditorFrame() {
  const searchParams = useSearchParams();
  const page = searchParams?.get("page") ?? "home";
  const token = searchParams?.get("token");
  const [valid, setValid] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) {
      setValid(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`/api/admin/editor-validate?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.valid === true) {
          setValid(true);
        } else if (process.env.NODE_ENV === "development") {
          setValid(true);
        } else {
          setValid(false);
        }
      })
      .catch(() => {
        if (process.env.NODE_ENV === "development") {
          setValid(true);
        } else {
          setValid(false);
        }
      })
      .finally(() => clearTimeout(timeout));
  }, [token]);

  if (valid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600">Checking…</p>
      </div>
    );
  }
  if (!valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600">Invalid or missing editor token.</p>
      </div>
    );
  }

  const pageId = EDITABLE_PAGES.some((p) => p.id === page) ? page : "home";

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-amber-100 border-b border-amber-300 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <span className="font-medium text-amber-900">
          Editor Mode — {pageId}
          {saved && <span className="ml-2 opacity-80" style={{ color: "var(--color-primary)" }}>(Saved)</span>}
        </span>
        <select
          className="border rounded px-2 py-1 text-sm"
          value={pageId}
          onChange={(e) => {
            const next = new URLSearchParams(searchParams?.toString() ?? "");
            next.set("page", e.target.value);
            window.location.search = next.toString();
          }}
        >
          {EDITABLE_PAGES.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-h-0">
        <BlockEditor
          pageId={pageId}
          token={token ?? ""}
          onSave={() => setSaved(true)}
        />
      </div>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <EditorFrame />
    </Suspense>
  );
}
