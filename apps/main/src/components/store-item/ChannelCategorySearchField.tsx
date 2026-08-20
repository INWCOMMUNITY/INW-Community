"use client";

import { useEffect, useState } from "react";
import { listingHintClass, listingInputClass } from "@/components/store-item/listing-form-styles";
import type { ListOnCategoryProvider } from "@/lib/list-on-channel-category";

export type ChannelCategoryChoice = {
  id: string;
  name: string;
  path: string;
};

type ChannelCategorySearchFieldProps = {
  provider: ListOnCategoryProvider;
  selectedId: string;
  selectedLabel: string;
  onSelect: (choice: ChannelCategoryChoice) => void;
  onClear: () => void;
  disabled?: boolean;
};

export function ChannelCategorySearchField({
  provider,
  selectedId,
  selectedLabel,
  onSelect,
  onClear,
  disabled,
}: ChannelCategorySearchFieldProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChannelCategoryChoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = provider === "etsy" ? "Etsy" : "eBay";

  useEffect(() => {
    const q = query.trim();
    if (selectedId || q.length < 2) {
      setResults([]);
      if (q.length < 2) setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setError(null);
    const t = setTimeout(() => {
      const path =
        provider === "etsy"
          ? `/api/channels/etsy/categories?q=${encodeURIComponent(q)}`
          : `/api/channels/ebay/categories?q=${encodeURIComponent(q)}`;
      fetch(path, { credentials: "include" })
        .then(async (r) => {
          const data: {
            categories?: Array<{
              taxonomyId?: number;
              categoryId?: string;
              categoryName?: string;
              categoryPath?: string;
            }>;
            error?: string;
          } = await r.json().catch(() => ({}));
          if (cancelled) return;
          if (!r.ok) {
            setResults([]);
            setError(data.error ?? `${label} category search failed.`);
            return;
          }
          const mapped: ChannelCategoryChoice[] = (data.categories ?? [])
            .map((c) => {
              const id =
                provider === "etsy"
                  ? c.taxonomyId != null
                    ? String(c.taxonomyId)
                    : ""
                  : String(c.categoryId ?? "");
              const name = c.categoryName ?? "";
              if (!id || !name) return null;
              return { id, name, path: c.categoryPath || name };
            })
            .filter((c): c is ChannelCategoryChoice => c != null);
          setResults(mapped);
          setError(null);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setError("Category search failed. Check your connection and try again.");
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, provider, selectedId, label]);

  if (selectedId) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {selectedLabel || `${label} category #${selectedId}`}
          </p>
          <p className="text-xs text-gray-500">
            {label} category #{selectedId}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onClear();
            setQuery("");
          }}
          className="text-sm text-red-600 hover:underline shrink-0"
          disabled={disabled}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${label} categories…`}
        className={listingInputClass}
        disabled={disabled}
        autoFocus
      />
      <p className={listingHintClass}>Type at least 2 characters to search.</p>
      {searching ? <p className="text-xs text-gray-500">Searching {label}…</p> : null}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {!searching && !error && query.trim().length >= 2 && results.length === 0 ? (
        <p className="text-xs text-gray-500">No categories found. Try different keywords.</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelect(c);
                  setQuery("");
                  setResults([]);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{c.name}</span>
                {c.path && c.path !== c.name ? (
                  <span className="block text-xs text-gray-500 truncate">{c.path}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
