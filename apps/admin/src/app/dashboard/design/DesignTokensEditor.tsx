"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

const TOKEN_KEYS = [
  "primaryColor", "secondaryColor", "backgroundColor", "textColor", "headingColor", "linkColor",
  "buttonColor", "buttonTextColor", "buttonHoverColor", "buttonHoverTextColor",
  "headingFont", "bodyFont", "headingFontSize", "bodyFontSize", "lineHeight", "letterSpacing",
  "buttonBorderRadius", "buttonPadding", "sectionPadding", "columnGap", "maxWidth",
  "sectionAltColor",
];

const DEFAULTS: Record<string, string> = {
  primaryColor: "#505542",
  secondaryColor: "#3E432F",
  backgroundColor: "#ffffff",
  textColor: "#505542",
  headingColor: "#3E432F",
  linkColor: "#505542",
  buttonColor: "#505542",
  buttonTextColor: "#ffffff",
  buttonHoverColor: "#FDEDCC",
  buttonHoverTextColor: "#505542",
  headingFont: "Fahkwang, sans-serif",
  bodyFont: "Helvetica Neue, Helvetica, Arial, sans-serif",
  headingFontSize: "2rem",
  bodyFontSize: "1rem",
  lineHeight: "1.6",
  letterSpacing: "0",
  buttonBorderRadius: "4px",
  buttonPadding: "0.75rem 1.5rem",
  sectionPadding: "3rem 1.5rem",
  columnGap: "2rem",
  maxWidth: "1200px",
  sectionAltColor: "#FDEDCC",
};

export function DesignTokensEditor() {
  const router = useRouter();
  const [tokens, setTokens] = useState<Record<string, string>>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/design-tokens`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") {
          setTokens((prev) => ({ ...DEFAULTS, ...prev, ...data }));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/design-tokens`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-code": ADMIN_CODE },
        body: JSON.stringify(tokens),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TOKEN_KEYS.map((key) => (
          <div key={key}>
            <label className="block text-sm font-medium mb-1">{key}</label>
            <input
              type="text"
              value={tokens[key] ?? DEFAULTS[key] ?? ""}
              onChange={(e) => setTokens((prev) => ({ ...prev, [key]: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded px-4 py-2 disabled:opacity-50"
        style={{ backgroundColor: "#505542", color: "#fff" }}
      >
        {saving ? "Saving…" : "Save design tokens"}
      </button>
    </div>
  );
}
