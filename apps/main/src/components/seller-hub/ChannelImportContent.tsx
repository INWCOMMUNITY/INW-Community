"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import { ShareListingsToFeedPrompt } from "@/components/feed/ShareListingsToFeedPrompt";
import { easedImportPercent } from "@/lib/channels/import-job-progress";
import {
  ImportPercentBar,
  ImportResultTabs,
  type ImportResultImported,
  type ImportResultSkipped,
} from "@/components/seller-hub/ImportJobOverlay";

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
  jobId?: string;
  imported?: ImportResultImported[];
  skipped?: ImportResultSkipped[];
};

type ImportJobStatus = {
  id: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  processed?: number;
  progress: number;
  currentTitle?: string | null;
  imported?: ImportResultImported[];
  skipped?: ImportResultSkipped[];
};

const LISTING_TIMEOUT_MS: Record<string, number> = {
  ebay: 120_000,
};

export function ChannelImportContent() {
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider") || "etsy";
  const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
  const importPath = useMemo(() => `/api/channels/${provider}/import`, [provider]);
  const listingTimeoutMs = LISTING_TIMEOUT_MS[provider] ?? 60_000;

  const [listings, setListings] = useState<RemoteListing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [shareItemIds, setShareItemIds] = useState<string[]>([]);
  const [overlay, setOverlay] = useState<"progress" | "result" | null>(null);
  const [jobPercent, setJobPercent] = useState(0);
  const [jobProcessed, setJobProcessed] = useState(0);
  const [jobTotal, setJobTotal] = useState(0);
  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const [resultImported, setResultImported] = useState<ImportResultImported[]>([]);
  const [resultSkipped, setResultSkipped] = useState<ImportResultSkipped[]>([]);
  const [resultTab, setResultTab] = useState<"on-inw" | "attention">("on-inw");

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

  const titleFor = (id: string) => listings.find((l) => l.externalListingId === id)?.title;
  const photoFor = (id: string) => listings.find((l) => l.externalListingId === id)?.photos?.[0];

  const applyJobStatus = (job: ImportJobStatus, inFlight: boolean) => {
    const processed = job.processed ?? job.completed + job.failed;
    setJobPercent(easedImportPercent(job.progress ?? 0, inFlight, processed));
    setJobProcessed(processed);
    setJobTotal(job.total);
    if (job.currentTitle) setJobTitle(job.currentTitle);
  };

  const runSequentialImport = async (listingIds: string[], merge = false) => {
    if (listingIds.length === 0) return;
    setImporting(true);
    setError(null);
    setOverlay("progress");
    setJobPercent(4);
    setJobProcessed(0);
    setJobTotal(listingIds.length);
    setJobTitle(titleFor(listingIds[0]) ?? null);
    setStatusMessage("Importing…");

    const startRes = await fetch("/api/channels/import-job", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, listingIds }),
    });
    const startData = (await startRes.json().catch(() => ({}))) as ImportJobStatus & {
      jobId?: string;
      error?: string;
    };
    if (!startRes.ok || !startData.jobId) {
      const msg = startData.error ?? "Could not start import.";
      setError(msg);
      setStatusMessage(msg);
      setOverlay(null);
      setImporting(false);
      return;
    }
    const jobId = startData.jobId;
    applyJobStatus(startData, true);

    const batchImported: ImportResultImported[] = [];
    const batchSkipped: ImportResultSkipped[] = [];

    const poll = window.setInterval(() => {
      void fetch(`/api/channels/import-job/${jobId}`, { credentials: "include" })
        .then((r) => r.json())
        .then((job: ImportJobStatus) => applyJobStatus(job, true))
        .catch(() => undefined);
    }, 800);

    try {
      for (const id of listingIds) {
        setJobTitle(titleFor(id) ?? null);
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), listingTimeoutMs);
        try {
          const res = await fetch(importPath, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listingIds: [id], jobId }),
            signal: controller.signal,
          });
          const data = (await res.json().catch(() => ({}))) as ImportApiResponse;
          if (!res.ok) {
            batchSkipped.push({
              externalListingId: id,
              title: titleFor(id),
              photo: photoFor(id),
              step: "create",
              reason: data.error ?? "Import failed. Try again.",
              hint: data.hint,
              retryable: true,
            });
          } else {
            batchImported.push(...(data.imported ?? []));
            batchSkipped.push(...(data.skipped ?? []));
          }
        } catch (e) {
          const timedOut = e instanceof DOMException && e.name === "AbortError";
          batchSkipped.push({
            externalListingId: id,
            title: titleFor(id),
            photo: photoFor(id),
            step: "create",
            reason: timedOut
              ? "Import timed out. Try this listing again."
              : "Import failed. Try again.",
            retryable: true,
          });
        } finally {
          window.clearTimeout(timeout);
        }
      }

      const jobRes = await fetch(`/api/channels/import-job/${jobId}`, { credentials: "include" });
      const job = (await jobRes.json().catch(() => ({}))) as ImportJobStatus;
      const imported = job.imported?.length ? job.imported : batchImported;
      const skipped = job.skipped?.length ? job.skipped : batchSkipped;
      applyJobStatus({ ...job, progress: 100, status: "completed" }, false);

      const nextImported = merge ? [...resultImported, ...imported] : imported;
      const retried = new Set(listingIds);
      const nextSkipped = merge
        ? [...resultSkipped.filter((s) => !retried.has(s.externalListingId)), ...skipped]
        : skipped;

      setResultImported(nextImported);
      setResultSkipped(nextSkipped);
      setResultTab(
        nextImported.length === 0 && nextSkipped.length > 0 ? "attention" : "on-inw"
      );
      setOverlay("result");
      setSelected(new Set());
      setStatusMessage(null);
    } finally {
      window.clearInterval(poll);
      setImporting(false);
    }
  };

  const runImport = async () => {
    if (selected.size === 0) return;
    await runSequentialImport(Array.from(selected));
  };

  const stickyTone = error ? "text-red-700" : "text-gray-600";

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

      {error && overlay !== "result" ? (
        <p className="mt-6 text-sm font-medium text-red-700 whitespace-pre-wrap">{error}</p>
      ) : null}

      {importable.length > 0 ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t-2 border-[var(--color-primary)] bg-white p-4 shadow-lg">
          <div className="max-w-2xl mx-auto space-y-3">
            {statusMessage && overlay !== "progress" ? (
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

      {overlay ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            {overlay === "progress" ? (
              <div className="p-6">
                <h2
                  className="mb-4 text-lg font-bold"
                  style={{ fontFamily: "var(--font-heading)", color: "#3E432F" }}
                >
                  Importing listings
                </h2>
                <ImportPercentBar
                  percent={jobPercent}
                  processed={jobProcessed}
                  total={jobTotal}
                  currentTitle={jobTitle}
                  actionWord={provider === "ebay" ? "Migrating" : "Importing"}
                />
              </div>
            ) : (
              <ImportResultTabs
                imported={resultImported}
                skipped={resultSkipped}
                tab={resultTab}
                onTab={setResultTab}
                onShare={() => {
                  const ids = resultImported
                    .map((row) => row.storeItemId)
                    .filter((id): id is string => Boolean(id));
                  if (ids.length > 0) setShareItemIds(ids);
                }}
                onDone={() => {
                  setOverlay(null);
                  void load();
                }}
                onRetry={(ids) => {
                  void runSequentialImport(ids, true);
                }}
                retrying={importing}
              />
            )}
          </div>
        </div>
      ) : null}

      <ShareListingsToFeedPrompt
        open={shareItemIds.length > 0}
        storeItemIds={shareItemIds}
        onClose={() => setShareItemIds([])}
      />
    </div>
  );
}
