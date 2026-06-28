"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";

type RemoteListing = {
  externalListingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  photos: string[];
  alreadyLinked?: boolean;
};

export function ChannelImportContent() {
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") || "etsy";
  const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
  const importPath = useMemo(() => `/api/channels/${provider}/import`, [provider]);

  const [listings, setListings] = useState<RemoteListing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(importPath, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? `Could not load your ${label} listings.`);
        setListings([]);
        return;
      }
      setListings(Array.isArray(data.listings) ? data.listings : []);
    } catch {
      setError(`Could not load your ${label} listings.`);
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [importPath, label]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(importPath, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingIds: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Import failed. Try again.");
        return;
      }
      const importedCount = data.imported?.length ?? 0;
      const skipped = data.skipped ?? [];
      const summary =
        data.summary ??
        (importedCount > 0
          ? `Imported ${importedCount} listing${importedCount === 1 ? "" : "s"}.`
          : "No listings were imported.");
      setDone(summary);
      if (importedCount === 0 && (data.hint || skipped.length > 0)) {
        setError(data.hint ?? summary);
      }
      setSelected(new Set());
      await load();
    } catch {
      setError("Import failed. Try again.");
    } finally {
      setImporting(false);
    }
  };

  const importable = listings.filter((l) => !l.alreadyLinked);

  return (
    <div className="max-w-2xl mx-auto min-w-0 pb-24">
      <Link
        href="/seller-hub/channels"
        className="text-sm text-gray-600 hover:underline mb-4 inline-block"
      >
        ← Back to Sync Stores
      </Link>
      <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-heading)" }}>
        Import from {label}
      </h1>
      <p className="text-gray-600 mb-6">
        Select the {label} listings to bring into your INW store. Imported items stay in sync: a sale on
        either store updates inventory on both.
      </p>

      {loading ? (
        <p className="text-gray-500 py-8 text-center">Loading listings…</p>
      ) : listings.length === 0 ? (
        <p className="text-gray-500 py-8 text-center">No {label} listings found.</p>
      ) : (
        <ul className="divide-y divide-gray-200 border-2 border-[var(--color-primary)] rounded-lg overflow-hidden bg-white">
          {listings.map((l) => {
            const isSelected = selected.has(l.externalListingId);
            return (
              <li key={l.externalListingId}>
                <button
                  type="button"
                  disabled={l.alreadyLinked}
                  onClick={() => !l.alreadyLinked && toggle(l.externalListingId)}
                  className={`flex w-full items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors ${
                    l.alreadyLinked ? "opacity-50 cursor-default" : ""
                  }`}
                >
                  {l.photos[0] ? (
                    <div className="relative h-14 w-14 shrink-0 rounded-md overflow-hidden bg-gray-100">
                      <Image src={l.photos[0]} alt="" fill className="object-cover" sizes="56px" unoptimized />
                    </div>
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-md bg-gray-100 border border-gray-200" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-snug line-clamp-2">{l.title}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      ${(l.priceCents / 100).toFixed(2)} · Qty {l.quantity}
                    </p>
                    {l.alreadyLinked ? (
                      <p className="text-xs text-green-700 font-medium mt-1">Already imported</p>
                    ) : null}
                  </div>
                  {!l.alreadyLinked ? (
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-[var(--color-primary)] text-sm font-bold ${
                        isSelected ? "bg-[var(--color-primary)] text-white" : "bg-white"
                      }`}
                    >
                      {isSelected ? "✓" : ""}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {done && !error ? (
        <p className="mt-6 text-sm font-medium text-green-800 whitespace-pre-wrap">{done}</p>
      ) : null}
      {error ? (
        <p className="mt-6 text-sm font-medium text-red-700 whitespace-pre-wrap">{error}</p>
      ) : null}

      {importable.length > 0 ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t-2 border-[var(--color-primary)] bg-white p-4 shadow-lg">
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={importing || selected.size === 0}
              className="w-full rounded-lg py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {importing
                ? "Importing…"
                : `Import ${selected.size > 0 ? `${selected.size} ` : ""}selected`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
