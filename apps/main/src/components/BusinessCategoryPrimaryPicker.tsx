"use client";

import { useMemo, useState } from "react";
import type { BusinessCategoryOption } from "@/lib/business-categories";
import {
  filterBusinessCategoryPresets,
  recommendedBusinessCategoryPresets,
} from "@/lib/business-category-suggest";

interface BusinessCategoryPrimaryPickerProps {
  value: string;
  onChange: (primary: string) => void;
  shortDescription: string;
  fullDescription: string;
  presets: BusinessCategoryOption[];
  placeholder?: string;
  required?: boolean;
}

export function BusinessCategoryPrimaryPicker({
  value,
  onChange,
  shortDescription,
  fullDescription,
  presets,
  placeholder = "Search categories…",
  required = false,
}: BusinessCategoryPrimaryPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");

  const filtered = useMemo(
    () => filterBusinessCategoryPresets(presets, search),
    [presets, search]
  );

  const recommended = useMemo(
    () =>
      recommendedBusinessCategoryPresets(
        presets,
        shortDescription,
        fullDescription,
        search,
        8
      ),
    [presets, shortDescription, fullDescription, search]
  );

  const recommendedLabels = new Set(recommended.map((r) => r.label));

  function pickPreset(p: BusinessCategoryOption) {
    onChange(p.label);
    setOpen(false);
    setSearch("");
    setCustomMode(false);
    setCustomText("");
  }

  function applyCustom() {
    const t = customText.trim();
    if (!t) return;
    onChange(t);
    setOpen(false);
    setSearch("");
    setCustomMode(false);
    setCustomText("");
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setCustomMode(false);
          setSearch("");
        }}
        className={`w-full border rounded px-3 py-2 text-left bg-white flex justify-between items-center gap-2 ${
          required && !value.trim() ? "border-red-300" : "border-gray-300"
        }`}
      >
        <span className={value.trim() ? "text-gray-900" : "text-gray-500"}>
          {value.trim() || "Choose primary category"}
        </span>
        <span className="text-gray-400 text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/20"
            aria-label="Close"
            onClick={() => {
              setOpen(false);
              setCustomMode(false);
            }}
          />
          <div className="absolute z-50 left-0 right-0 mt-1 border rounded-lg bg-white shadow-lg max-h-[min(70vh,420px)] overflow-hidden flex flex-col">
            <div className="p-2 border-b border-gray-100">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={placeholder}
                className="w-full border rounded px-2 py-2 text-sm"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-3">
              {!customMode && recommended.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Suggested for your description
                  </p>
                  <ul className="space-y-1">
                    {recommended.map((p) => (
                      <li key={p.label}>
                        <button
                          type="button"
                          onClick={() => pickPreset(p)}
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-100 text-sm"
                        >
                          {p.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!customMode && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {search.trim() ? "Matching categories" : "All categories"}
                  </p>
                  <ul className="space-y-1">
                    {filtered.map((p) => (
                      <li key={p.label}>
                        <button
                          type="button"
                          onClick={() => pickPreset(p)}
                          className={`w-full text-left px-2 py-1.5 rounded hover:bg-gray-100 text-sm ${
                            recommendedLabels.has(p.label) ? "text-gray-700" : ""
                          }`}
                        >
                          {p.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {filtered.length === 0 && (
                    <p className="text-sm text-gray-500 py-2">No matches. Try another search or use a custom category.</p>
                  )}
                </div>
              )}
              {!customMode && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomMode(true);
                    setCustomText(value.trim() && !presets.some((x) => x.label === value.trim()) ? value.trim() : "");
                  }}
                  className="text-sm text-[var(--color-primary)] font-medium hover:underline w-full text-left"
                >
                  + Custom category
                </button>
              )}
              {customMode && (
                <div className="space-y-2 pt-1">
                  <label className="block text-xs font-medium text-gray-600">Custom primary category</label>
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyCustom();
                      }
                    }}
                    className="w-full border rounded px-2 py-2 text-sm"
                    placeholder="e.g. Specialty retail"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={applyCustom} className="btn text-sm py-1.5 px-3">
                      Use custom
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomMode(false);
                        setCustomText("");
                      }}
                      className="text-sm text-gray-600 hover:underline"
                    >
                      Back to list
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
