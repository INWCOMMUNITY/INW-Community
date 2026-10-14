"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_ETSY_LISTINGS_PATH,
  APPS_AIRPORT_ETSY_PATH,
  APPS_AIRPORT_ETSY_SETTINGS_PATH,
  formatEtsyCents,
} from "@/lib/etsy/apps-airport";
import { parseSellerShippingDollars } from "@/lib/etsy/import-shipping";

type Candidate = {
  etsyListingId: string;
  title: string;
  state: string;
  supported: boolean;
  unsupportedReason: string | null;
  priceCents: number | null;
  quantity: number | null;
  sku: string | null;
  imageUrl: string | null;
  recommendedStockMode: "PHYSICAL" | "MADE_TO_ORDER" | null;
};

type StockMode = "PHYSICAL" | "MADE_TO_ORDER";
type StockModePolicy = "RECOMMENDED" | "PHYSICAL" | "MADE_TO_ORDER";

type BatchProgress = {
  id: string;
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  stockModePolicy: StockModePolicy;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  processed: number;
  remaining: number;
  discoverComplete: boolean;
  scanning: boolean;
  percent: number | null;
  avgItemMs: number | null;
  etaSeconds: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastProgressAt: string | null;
  lastError: string | null;
  cancelRequested: boolean;
  failures: Array<{ etsyListingId: string; message: string }>;
};

function formatEta(seconds: number | null): string {
  if (seconds == null) return "Calculating…";
  if (seconds < 60) return `About ${seconds}s remaining`;
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `About ${mins} min remaining`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `About ${hrs}h ${rem}m remaining` : `About ${hrs}h remaining`;
}

const PERSONALIZATION_NOTICE_PREFIX = "PERSONALIZATION:";

function batchIsActive(batch: BatchProgress | null): boolean {
  return batch != null && (batch.state === "PENDING" || batch.state === "RUNNING");
}

export default function AppsAirportEtsyImportPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [shopName, setShopName] = useState<string | null>(null);
  const [etsyReportedCount, setEtsyReportedCount] = useState<number | null>(null);
  const [alreadyLinkedCount, setAlreadyLinkedCount] = useState(0);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [stockMode, setStockMode] = useState<StockMode | null>(null);
  const [importing, setImporting] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [step, setStep] = useState<"discover" | "review" | "shipping">("discover");
  const [bulkPolicy, setBulkPolicy] = useState<StockModePolicy>("RECOMMENDED");
  const [shippingItems, setShippingItems] = useState<Candidate[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [priceById, setPriceById] = useState<Record<string, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [shippingLoading, setShippingLoading] = useState(false);
  const [singleShippingPrice, setSingleShippingPrice] = useState("");
  const [bulkStarting, setBulkStarting] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [personalizationNotice, setPersonalizationNotice] = useState<{
    lines: string[];
    continueHref?: string;
  } | null>(null);
  const shownBulkNotice = useRef<string | null>(null);

  const loadBatch = useCallback(async () => {
    try {
      const response = await fetch("/api/etsy/import/batch", { credentials: "include" });
      if (!response.ok) return;
      const body = (await response.json()) as { batch?: BatchProgress | null };
      setBatch(body.batch ?? null);
    } catch {
      /* ignore poll errors */
    }
  }, []);

  const load = useCallback(async (nextOffset = 0, append = false) => {
    setLoading(true);
    setError(null);
    setConnectionError(null);
    try {
      const response = await fetch(`/api/etsy/import/candidates?offset=${nextOffset}`, {
        credentials: "include",
      });
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        candidates?: Candidate[];
        shopName?: string | null;
        pageInfo?: { hasNextPage?: boolean; offset?: number };
        etsyReportedCount?: number;
        alreadyLinkedCount?: number;
      };
      if (!response.ok) {
        if (body.code === "CONNECTION_REQUIRED" || body.code === "UNAUTHORIZED") {
          setConnectionError(
            body.code === "UNAUTHORIZED"
              ? "Etsy authorization expired. Reconnect, then try Import again."
              : (body.error ?? "Connect Etsy first.")
          );
        } else {
          setError(body.error ?? "Could not load Etsy listings.");
        }
        if (!append) setCandidates([]);
        return;
      }
      setShopName(body.shopName ?? null);
      setEtsyReportedCount(
        typeof body.etsyReportedCount === "number" ? body.etsyReportedCount : null
      );
      setAlreadyLinkedCount(
        typeof body.alreadyLinkedCount === "number" ? body.alreadyLinkedCount : 0
      );
      setCandidates((prev) =>
        append ? [...prev, ...(body.candidates ?? [])] : body.candidates ?? []
      );
      setHasNextPage(Boolean(body.pageInfo?.hasNextPage));
      setOffset(body.pageInfo?.offset ?? nextOffset);
    } catch {
      setError("Could not load Etsy listings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(0, false);
    void loadBatch();
  }, [load, loadBatch]);

  useEffect(() => {
    if (!batchIsActive(batch)) return;
    const id = window.setInterval(() => {
      void loadBatch();
    }, 2500);
    return () => window.clearInterval(id);
  }, [batch, loadBatch]);

  useEffect(() => {
    if (!batch) return;
    if (batch.state === "COMPLETED" || batch.state === "CANCELLED") {
      void load(0, false);
    }
  }, [batch, load]);

  useEffect(() => {
    if (!batch || batch.state !== "COMPLETED") return;
    if (shownBulkNotice.current === batch.id) return;
    const lines = batch.failures
      .filter((failure) => failure.message.startsWith(PERSONALIZATION_NOTICE_PREFIX))
      .map(
        (failure) =>
          `#${failure.etsyListingId}: ${failure.message.slice(PERSONALIZATION_NOTICE_PREFIX.length).trim()}`
      );
    if (lines.length === 0) return;
    shownBulkNotice.current = batch.id;
    setPersonalizationNotice({ lines });
  }, [batch]);

  async function openReview(candidate: Candidate) {
    setError(null);
    setReviewLoading(true);
    setStep("review");
    setSelected(null);
    setStockMode(null);
    setSingleShippingPrice("");
    try {
      const response = await fetch(
        `/api/etsy/import/candidates?etsyListingId=${encodeURIComponent(candidate.etsyListingId)}`,
        { credentials: "include" }
      );
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        candidate?: Candidate;
      };
      if (!response.ok || !body.candidate) {
        if (body.code === "UNAUTHORIZED" || body.code === "CONNECTION_REQUIRED") {
          setConnectionError(
            body.error ?? "Reconnect Etsy in Connection Settings, then try again."
          );
          setStep("discover");
          return;
        }
        setError(body.error ?? "Could not load listing details.");
        setStep("discover");
        return;
      }
      if (!body.candidate.supported) {
        setError(
          body.candidate.unsupportedReason ??
            "This Etsy listing cannot be imported into INW."
        );
        setStep("discover");
        return;
      }
      setSelected(body.candidate);
      setStockMode(body.candidate.recommendedStockMode ?? "PHYSICAL");
    } catch {
      setError("Could not load listing details.");
      setStep("discover");
    } finally {
      setReviewLoading(false);
    }
  }

  async function onImport(shippingCostCents?: number) {
    if (!selected || !stockMode) {
      setError("Choose a stock mode before importing.");
      return;
    }
    const cents = shippingCostCents ?? parseSellerShippingDollars(singleShippingPrice);
    if (cents == null) {
      setError("Enter a shipping price, or ship for free.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/etsy/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          etsyListingId: selected.etsyListingId,
          stockMode,
          shippingCostCents: cents,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        storeItemId?: string;
        status?: string;
        code?: string;
        personalizationWarning?: string | null;
      };
      if (!response.ok || !body.storeItemId) {
        if (body.code === "UNAUTHORIZED" || body.code === "CONNECTION_REQUIRED") {
          setConnectionError(
            body.error ?? "Reconnect Etsy in Connection Settings, then try again."
          );
        } else {
          setError(body.error ?? "Import failed.");
        }
        return;
      }
      const href = `${APPS_AIRPORT_ETSY_PATH}?imported=${encodeURIComponent(body.storeItemId)}`;
      if (body.personalizationWarning) {
        setPersonalizationNotice({
          lines: [body.personalizationWarning],
          continueHref: href,
        });
        return;
      }
      router.push(href);
    } catch {
      setError("Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function onImportAll(priced?: { listingIds: string[]; shippingPrices: Record<string, number> }) {
    setBulkStarting(true);
    setError(null);
    setConnectionError(null);
    try {
      const response = await fetch("/api/etsy/import/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockModePolicy: bulkPolicy,
          ...(priced
            ? { listingIds: priced.listingIds, shippingPrices: priced.shippingPrices }
            : {}),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        batch?: BatchProgress;
        status?: string;
      };
      if (!response.ok || !body.batch) {
        if (body.code === "UNAUTHORIZED" || body.code === "CONNECTION_REQUIRED") {
          setConnectionError(body.error ?? "Reconnect Etsy, then try again.");
        } else {
          setError(body.error ?? "Could not start bulk import.");
        }
        return;
      }
      setBatch(body.batch);
      setStep("discover");
    } catch {
      setError("Could not start bulk import.");
    } finally {
      setBulkStarting(false);
    }
  }

  async function openShippingPage() {
    setShippingLoading(true);
    setError(null);
    setConnectionError(null);
    try {
      const all: Candidate[] = [];
      let nextOffset = 0;
      for (let page = 0; page < 200; page += 1) {
        const response = await fetch(
          `/api/etsy/import/candidates?offset=${nextOffset}&limit=50`,
          { credentials: "include" }
        );
        const body = (await response.json()) as {
          error?: string;
          code?: string;
          candidates?: Candidate[];
          pageInfo?: { hasNextPage?: boolean; offset?: number };
        };
        if (!response.ok) {
          if (body.code === "CONNECTION_REQUIRED" || body.code === "UNAUTHORIZED") {
            setConnectionError(body.error ?? "Reconnect Etsy, then try again.");
          } else {
            setError(body.error ?? "Could not load Etsy listings.");
          }
          return;
        }
        all.push(...(body.candidates ?? []));
        if (!body.pageInfo?.hasNextPage) break;
        const offset = body.pageInfo.offset ?? nextOffset;
        if (offset === nextOffset) break;
        nextOffset = offset;
        if (page === 199) {
          setError("This shop has too many listings to price at once. Ship for free instead.");
          return;
        }
      }
      if (all.length === 0) {
        setError("No listings left to import.");
        return;
      }
      setShippingItems(all);
      setCheckedIds(new Set());
      setPriceById({});
      setBulkPrice("");
      setStep("shipping");
    } catch {
      setError("Could not load Etsy listings.");
    } finally {
      setShippingLoading(false);
    }
  }

  function applyBulkPrice() {
    const cents = parseSellerShippingDollars(bulkPrice);
    if (checkedIds.size === 0) {
      setError("Check the listings that should share this shipping price.");
      return;
    }
    if (cents == null) {
      setError("Enter a shipping price to apply.");
      return;
    }
    const formatted = (cents / 100).toFixed(2);
    setPriceById((prev) => {
      const next = { ...prev };
      for (const id of checkedIds) next[id] = formatted;
      return next;
    });
    setError(null);
  }

  function importWithPrices() {
    const shippingPrices: Record<string, number> = {};
    for (const item of shippingItems) {
      const cents = parseSellerShippingDollars(priceById[item.etsyListingId] ?? "");
      if (cents == null) {
        setError("Enter a shipping price for every listing, or ship for free.");
        return;
      }
      shippingPrices[item.etsyListingId] = cents;
    }
    void onImportAll({
      listingIds: shippingItems.map((item) => item.etsyListingId),
      shippingPrices,
    });
  }

  async function onCancelBulk() {
    setBulkCancelling(true);
    setError(null);
    try {
      const response = await fetch("/api/etsy/import/batch/cancel", {
        method: "POST",
        credentials: "include",
      });
      const body = (await response.json()) as {
        error?: string;
        batch?: BatchProgress;
      };
      if (!response.ok) {
        setError(body.error ?? "Could not cancel import.");
        return;
      }
      if (body.batch) setBatch(body.batch);
      else void loadBatch();
    } catch {
      setError("Could not cancel import.");
    } finally {
      setBulkCancelling(false);
    }
  }

  const activeBulk = batchIsActive(batch);
  const estimateCount =
    etsyReportedCount != null
      ? Math.max(0, etsyReportedCount - alreadyLinkedCount)
      : candidates.length;

  return (
    <AppsAirportChrome
      title="Import from Etsy"
      subtitle="Bring Etsy listings into INW. Import does not publish them to Shopify or other marketplaces."
      crumbs={[
        { href: APPS_AIRPORT_ETSY_PATH, label: "Etsy" },
        { href: `${APPS_AIRPORT_ETSY_PATH}/import`, label: "Import" },
      ]}
    >
      {connectionError ? (
        <p className="mb-4 text-sm text-amber-800">
          {connectionError}{" "}
          <Link
            href={APPS_AIRPORT_ETSY_SETTINGS_PATH}
            className="underline"
            style={{ color: "var(--color-primary)" }}
            prefetch={false}
          >
            Connection Settings
          </Link>
        </p>
      ) : null}
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {batch ? (
        <div className="mb-6 rounded-[10px] border border-neutral-200 bg-neutral-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
                {batch.state === "COMPLETED"
                  ? "Import complete"
                  : batch.state === "CANCELLED"
                    ? "Import cancelled"
                    : batch.state === "FAILED"
                      ? "Import stopped"
                      : batch.scanning
                        ? "Scanning your Etsy shop…"
                        : "Importing from Etsy…"}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                {batch.scanning
                  ? "Finding active listings that are not linked yet."
                  : `${batch.processed} of ${batch.total || "…"} processed · ${batch.completed} imported · ${batch.skipped} already linked · ${batch.failed} failed`}
              </p>
              {activeBulk ? (
                <p className="mt-1 text-sm text-neutral-600">
                  {formatEta(batch.etaSeconds)}. You can leave this page — import continues in the
                  background.
                </p>
              ) : null}
              {batch.lastError && activeBulk ? (
                <p className="mt-1 text-sm text-amber-800">{batch.lastError}</p>
              ) : null}
              {batch.state === "FAILED" && batch.lastError ? (
                <p className="mt-1 text-sm text-red-700">{batch.lastError}</p>
              ) : null}
            </div>
            {activeBulk ? (
              <button
                type="button"
                className="btn border border-gray-300 bg-white hover:bg-gray-50 text-sm"
                style={{ color: "var(--color-heading)" }}
                disabled={bulkCancelling || batch.cancelRequested}
                onClick={() => void onCancelBulk()}
              >
                {batch.cancelRequested || bulkCancelling ? "Cancelling…" : "Cancel import"}
              </button>
            ) : null}
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${
                  batch.scanning
                    ? 8
                    : batch.percent != null
                      ? batch.percent
                      : activeBulk
                        ? 12
                        : 100
                }%`,
                background: "var(--color-primary)",
              }}
            />
          </div>
          {batch.failures.some((f) => !f.message.startsWith(PERSONALIZATION_NOTICE_PREFIX)) ? (
            <div className="mt-3 max-h-36 overflow-y-auto text-xs text-neutral-700">
              <p className="font-semibold text-neutral-800 mb-1">Recent failures</p>
              <ul className="space-y-1">
                {batch.failures
                  .filter((f) => !f.message.startsWith(PERSONALIZATION_NOTICE_PREFIX))
                  .slice(-8)
                  .map((f) => (
                  <li key={`${f.etsyListingId}-${f.message.slice(0, 24)}`}>
                    #{f.etsyListingId}: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(batch.state === "COMPLETED" || batch.state === "CANCELLED") && (
            <p className="mt-3 text-sm">
              <Link
                href={APPS_AIRPORT_ETSY_LISTINGS_PATH}
                className="underline font-medium"
                style={{ color: "var(--color-primary)" }}
                prefetch={false}
              >
                View linked listings
              </Link>
            </p>
          )}
        </div>
      ) : null}

      {step === "discover" ? (
        <>
          <div className="mb-6 rounded-[10px] border border-neutral-200 p-4">
            <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
              Import all active listings
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Import every active Etsy listing that is not already linked
              {estimateCount > 0 ? ` (about ${estimateCount} on this shop)` : ""}. This can take a
              while for large shops; progress and time remaining appear above.
            </p>
            <fieldset className="mt-3 space-y-2" disabled={activeBulk || bulkStarting}>
              <legend className="sr-only">Stock mode for bulk import</legend>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bulkPolicy"
                  checked={bulkPolicy === "RECOMMENDED"}
                  onChange={() => setBulkPolicy("RECOMMENDED")}
                />
                <span className="text-sm">Recommended per listing (usually physical stock)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bulkPolicy"
                  checked={bulkPolicy === "PHYSICAL"}
                  onChange={() => setBulkPolicy("PHYSICAL")}
                />
                <span className="text-sm">All physical stock (tracked quantity)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bulkPolicy"
                  checked={bulkPolicy === "MADE_TO_ORDER"}
                  onChange={() => setBulkPolicy("MADE_TO_ORDER")}
                />
                <span className="text-sm">All made to order</span>
              </label>
            </fieldset>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn"
                disabled={activeBulk || bulkStarting || shippingLoading || Boolean(connectionError)}
                onClick={() => void openShippingPage()}
              >
                {shippingLoading ? "Loading listings…" : "Set Shipping Prices"}
              </button>
              <button
                type="button"
                className="btn btn-pill-earth"
                disabled={activeBulk || bulkStarting || shippingLoading || Boolean(connectionError)}
                onClick={() => void onImportAll()}
              >
                {bulkStarting ? "Starting…" : activeBulk ? "Import running…" : "Ship for Free with INW (Appreciated)"}
              </button>
            </div>
          </div>

          <p className="mb-4 text-sm text-neutral-600">
            Or review one listing at a time to choose stock mode before importing.
          </p>
          {shopName || etsyReportedCount != null ? (
            <p className="mb-3 text-sm text-neutral-600">
              {shopName ? `Shop: ${shopName}. ` : null}
              {etsyReportedCount != null
                ? `Etsy returned ${etsyReportedCount} active listing${etsyReportedCount === 1 ? "" : "s"}`
                : null}
              {alreadyLinkedCount > 0
                ? ` · ${alreadyLinkedCount} already linked on this page`
                : null}
              .
            </p>
          ) : null}
          {loading && candidates.length === 0 ? (
            <p className="text-sm text-neutral-600">Loading…</p>
          ) : null}
          {candidates.length > 0 ? (
            <div className="overflow-x-auto rounded-[10px] border border-neutral-200">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-left">
                  <tr>
                    <th className="px-3 py-2">Listing</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.etsyListingId} className="border-t border-neutral-100">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          {candidate.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={candidate.imageUrl}
                              alt=""
                              className="h-12 w-12 shrink-0 rounded object-cover border border-neutral-200"
                            />
                          ) : (
                            <div className="h-12 w-12 shrink-0 rounded border border-neutral-200 bg-neutral-50" />
                          )}
                          <span className="truncate">{candidate.title}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">{candidate.state}</td>
                      <td className="px-3 py-2">{formatEtsyCents(candidate.priceCents)}</td>
                      <td className="px-3 py-2">{candidate.quantity ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="btn"
                          disabled={reviewLoading || activeBulk}
                          onClick={() => void openReview(candidate)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !loading ? (
            <p className="text-sm text-neutral-600">
              {etsyReportedCount === 0
                ? "Etsy returned no active listings for this connected shop. Confirm you’re connected to the right shop in Connection Settings."
                : alreadyLinkedCount > 0
                  ? "All active Etsy listings on this page are already linked in INW. Open Linked Listings to manage them."
                  : "No importable active listings found. If you see the listing in Etsy Shop Manager, reconnect Etsy and try again."}
            </p>
          ) : null}
          {hasNextPage ? (
            <button
              type="button"
              className="btn mt-4 border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              onClick={() => void load(offset, true)}
              disabled={loading}
            >
              Load more
            </button>
          ) : null}
        </>
      ) : null}

      {step === "shipping" ? (
        <div className="space-y-4">
          <div>
            <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
              Shipping prices
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Set what buyers pay to ship each listing on INW. Check listings to apply one price to all of them.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3 rounded-[10px] border border-neutral-200 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shippingItems.length > 0 && checkedIds.size === shippingItems.length}
                onChange={(e) => {
                  setCheckedIds(
                    e.target.checked
                      ? new Set(shippingItems.map((item) => item.etsyListingId))
                      : new Set()
                  );
                }}
              />
              Select all
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-neutral-600">Price for checked listings</span>
              <span className="inline-flex items-center gap-1">
                <span>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="w-28 rounded border px-2 py-1.5"
                  placeholder="0.00"
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                />
              </span>
            </label>
            <button type="button" className="btn" onClick={applyBulkPrice} disabled={bulkStarting}>
              Apply to selected
            </button>
          </div>
          <div className="overflow-x-auto rounded-[10px] border border-neutral-200">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left">
                <tr>
                  <th className="px-3 py-2 w-10" />
                  <th className="px-3 py-2">Listing</th>
                  <th className="px-3 py-2">Shipping price</th>
                </tr>
              </thead>
              <tbody>
                {shippingItems.map((item) => (
                  <tr key={item.etsyListingId} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        checked={checkedIds.has(item.etsyListingId)}
                        onChange={(e) => {
                          setCheckedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.etsyListingId);
                            else next.delete(item.etsyListingId);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="h-12 w-12 shrink-0 rounded object-cover border border-neutral-200"
                          />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded border border-neutral-200 bg-neutral-50" />
                        )}
                        <span className="truncate">{item.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        <span>$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Shipping price for ${item.title}`}
                          className="w-28 rounded border px-2 py-1.5"
                          placeholder="0.00"
                          value={priceById[item.etsyListingId] ?? ""}
                          onChange={(e) =>
                            setPriceById((prev) => ({
                              ...prev,
                              [item.etsyListingId]: e.target.value,
                            }))
                          }
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn"
              disabled={bulkStarting || activeBulk}
              onClick={importWithPrices}
            >
              {bulkStarting ? "Starting…" : "Import listings"}
            </button>
            <button
              type="button"
              className="btn btn-pill-earth"
              disabled={bulkStarting || activeBulk}
              onClick={() => void onImportAll()}
            >
              Ship for Free with INW (Appreciated)
            </button>
            <button
              type="button"
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              disabled={bulkStarting}
              onClick={() => {
                setStep("discover");
                setError(null);
              }}
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="max-w-lg space-y-4">
          {reviewLoading ? <p className="text-sm text-neutral-600">Loading listing details…</p> : null}
          {selected ? (
            <>
              <div className="flex items-start gap-4">
                {selected.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selected.imageUrl}
                    alt=""
                    className="h-28 w-28 shrink-0 rounded-[10px] object-cover border border-neutral-200"
                  />
                ) : (
                  <div className="h-28 w-28 shrink-0 rounded-[10px] border border-neutral-200 bg-neutral-50" />
                )}
                <div className="min-w-0">
                  <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
                    {selected.title}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {formatEtsyCents(selected.priceCents)} · qty {selected.quantity ?? "—"}
                  </p>
                </div>
              </div>
              <p className="text-sm text-neutral-600">
                Choose how INW should track inventory for this imported listing.
              </p>
              <fieldset className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="stockMode"
                    checked={stockMode === "PHYSICAL"}
                    onChange={() => setStockMode("PHYSICAL")}
                  />
                  <span className="text-sm">Physical stock (tracked quantity)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="stockMode"
                    checked={stockMode === "MADE_TO_ORDER"}
                    onChange={() => setStockMode("MADE_TO_ORDER")}
                  />
                  <span className="text-sm">Made to order</span>
                </label>
              </fieldset>
              <label className="block text-sm">
                <span className="mb-1 block font-medium" style={{ color: "var(--color-heading)" }}>
                  Shipping price on INW
                </span>
                <span className="inline-flex items-center gap-1">
                  <span>$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-28 rounded border px-2 py-1.5"
                    placeholder="0.00"
                    value={singleShippingPrice}
                    onChange={(e) => setSingleShippingPrice(e.target.value)}
                  />
                </span>
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn"
                  disabled={importing || !stockMode || activeBulk}
                  onClick={() => void onImport()}
                >
                  {importing ? "Importing…" : "Import to INW"}
                </button>
                <button
                  type="button"
                  className="btn btn-pill-earth"
                  disabled={importing || !stockMode || activeBulk}
                  onClick={() => void onImport(0)}
                >
                  Ship for Free with INW (Appreciated)
                </button>
                <button
                  type="button"
                  className="btn border border-gray-300 bg-white hover:bg-gray-50"
                  style={{ color: "var(--color-heading)" }}
                  disabled={importing}
                  onClick={() => {
                    setStep("discover");
                    setSelected(null);
                    setError(null);
                  }}
                >
                  Back
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {personalizationNotice ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          data-testid="etsy-personalization-notice"
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
              Custom options were not fully imported
            </h2>
            <p className="mt-2 text-sm text-neutral-700">
              The listing imported. Etsy custom options that INW cannot store were left off, so they will not show on the product or sync back.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-neutral-800">
              {personalizationNotice.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn mt-5"
              onClick={() => {
                const href = personalizationNotice.continueHref;
                setPersonalizationNotice(null);
                if (href) router.push(href);
              }}
            >
              {personalizationNotice.continueHref ? "Continue" : "Close"}
            </button>
          </div>
        </div>
      ) : null}
    </AppsAirportChrome>
  );
}
