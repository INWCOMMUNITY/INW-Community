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

type ImportApiResponse = {
  error?: string;
  hint?: string;
  summary?: string;
  imported?: unknown[];
  skipped?: unknown[];
};

const IMPORT_TIMEOUT_MS: Record<string, number> = {
  ebay: 120_000,
};

export function ChannelImportContent() {
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") || "etsy";
  const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
  const importPath = useMemo(() => `/api/channels/${provider}/import`, [provider]);
  const importTimeoutMs = IMPORT_TIMEOUT_MS[provider] ?? 60_000;

  const [listings, setListings] = useState<RemoteListing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const importable = useMemo(
    () => listings.filter((l) => !l.alreadyLinked),
    [listings]
  );
  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(
      (l) =>
        l.title.toLowerCase().includes(q) || l.externalListingId.toLowerCase().includes(q)
    );
  }, [listings, search]);
  const visibleImportable = useMemo(
    () => filteredListings.filter((l) => !l.alreadyLinked),
    [filteredListings]
  );
  const visibleImportableIds = useMemo(
    () => visibleImportable.map((l) => l.externalListingId),
    [visibleImportable]
  );
  const allImportableSelected =
    visibleImportableIds.length > 0 && visibleImportableIds.every((id) => selected.has(id));

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

  const toggleSelectAll = () => {
    if (allImportableSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleImportableIds) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleImportableIds) next.add(id);
        return next;
      });
    }
  };

  const runImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    setDone(null);
    setStatusMessage(
      provider === "ebay"
        ? "Importing from eBay… this can take up to a minute while listings migrate."
        : "Importing…"
    );

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), importTimeoutMs);

    try {
      const res = await fetch(importPath, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingIds: Array.from(selected) }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as ImportApiResponse;

      if (!res.ok) {
        const msg = data.error ?? "Import failed. Try again.";
        setError(msg);
        setStatusMessage(msg);
        return;
      }

      const importedCount = data.imported?.length ?? 0;
      const skipped = data.skipped ?? [];
      const summary =
        data.summary ??
        (importedCount > 0
          ? `Imported ${importedCount} listing${importedCount === 1 ? "" : "s"}.`
          : "No listings were imported.");

      if (importedCount === 0) {
        const failureMessage = data.hint ?? summary;
        setError(failureMessage);
        setDone(null);
        setStatusMessage(failureMessage);
        return;
      }

      setDone(summary);
      setError(null);
      setStatusMessage(summary);
      setSelected(new Set());
      await load();
    } catch (e) {
      const timedOut = e instanceof DOMException && e.name === "AbortError";
      const msg = timedOut
        ? "Import timed out. eBay imports can take a while — refresh the list to see if any items were added, then retry any that remain."
        : "Import failed. Try again.";
      setError(msg);
      setStatusMessage(msg);
    } finally {
      window.clearTimeout(timeout);
      setImporting(false);
    }
  };

  const stickyTone = error ? "text-red-700" : done ? "text-green-800" : "text-gray-600";

  return (
    <div className="max-w-2xl mx-auto min-w-0 pb-36">
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
        <>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${label} listings`}
            className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
            aria-label={`Search ${label} listings`}
          />
          <ul className="divide-y divide-gray-200 border-2 border-[var(--color-primary)] rounded-lg overflow-hidden bg-white">
          {visibleImportable.length > 0 ? (
            <li className="bg-gray-50">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-gray-100 transition-colors"
                aria-pressed={allImportableSelected}
              >
                <div className="h-14 w-14 shrink-0" aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900">
                    {allImportableSelected ? "Deselect all" : "Select all"}
                  </p>
                  <p className="text-sm text-gray-600 mt-0.5">
                    {visibleImportable.filter((l) => selected.has(l.externalListingId)).length} of{" "}
                    {visibleImportable.length} importable selected
                    {search.trim() ? " (matching search)" : ""}
                  </p>
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-[var(--color-primary)] text-sm font-bold ${
                    allImportableSelected ? "bg-[var(--color-primary)] text-white" : "bg-white"
                  }`}
                  aria-hidden
                >
                  {allImportableSelected ? "✓" : ""}
                </span>
              </button>
            </li>
          ) : null}
          {filteredListings.length === 0 ? (
            <li className="p-4 text-sm text-gray-500 text-center">
              No listings match “{search.trim()}”.
            </li>
          ) : (
            filteredListings.map((l) => {
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
          })
          )}
        </ul>
        </>
      )}

      {done && !error ? (
        <p className="mt-6 text-sm font-medium text-green-800 whitespace-pre-wrap">{done}</p>
      ) : null}
      {error ? (
        <p className="mt-6 text-sm font-medium text-red-700 whitespace-pre-wrap">{error}</p>
      ) : null}

      {importable.length > 0 ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t-2 border-[var(--color-primary)] bg-white p-4 shadow-lg">
          <div className="max-w-2xl mx-auto space-y-3">
            {statusMessage ? (
              <p className={`text-sm whitespace-pre-wrap ${stickyTone}`} role="status">
                {statusMessage}
              </p>
            ) : null}
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
