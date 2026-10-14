"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  formatCents,
} from "@/lib/shopify/apps-airport";

type Candidate = {
  shopifyProductId: string;
  title: string;
  status: string;
  supported: boolean;
  unsupportedReason: string | null;
  priceCents: number | null;
  sku: string | null;
  inventoryTracked: boolean | null;
  primaryLocationAvailable: number | null;
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
  failures: Array<{ shopifyProductId: string; message: string }>;
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

const METAFIELD_NOTICE_PREFIX = "METAFIELD:";

type MetafieldNotice = {
  title: string;
  lines: string[];
  continueHref?: string;
};

function metafieldLines(message: string): string {
  return message.startsWith(METAFIELD_NOTICE_PREFIX)
    ? message.slice(METAFIELD_NOTICE_PREFIX.length).trim()
    : message;
}

function batchIsActive(batch: BatchProgress | null): boolean {
  return batch != null && (batch.state === "PENDING" || batch.state === "RUNNING");
}

export default function AppsAirportShopifyImportPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [stockMode, setStockMode] = useState<StockMode | null>(null);
  const [importing, setImporting] = useState(false);
  const [step, setStep] = useState<"discover" | "review">("discover");
  const [metafieldNotice, setMetafieldNotice] = useState<MetafieldNotice | null>(null);
  const shownBulkNotice = useRef<string | null>(null);
  const [bulkPolicy, setBulkPolicy] = useState<StockModePolicy>("RECOMMENDED");
  const [bulkStarting, setBulkStarting] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const [batch, setBatch] = useState<BatchProgress | null>(null);

  const loadBatch = useCallback(async () => {
    try {
      const response = await fetch("/api/shopify/import/batch", { credentials: "include" });
      if (!response.ok) return;
      const body = (await response.json()) as { batch?: BatchProgress | null };
      setBatch(body.batch ?? null);
    } catch {
      /* ignore poll errors */
    }
  }, []);

  const load = useCallback(async (nextCursor?: string | null, append = false) => {
    setLoading(true);
    setError(null);
    setConnectionError(null);
    try {
      const qs = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
      const response = await fetch(`/api/shopify/import/candidates${qs}`, {
        credentials: "include",
      });
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        candidates?: Candidate[];
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
      if (!response.ok) {
        if (body.code === "CONNECTION_REQUIRED" || body.code === "LOCATION_REQUIRED") {
          setConnectionError(body.error ?? "Finish Shopify connection setup first.");
        } else {
          setError(body.error ?? "Could not load Shopify products.");
        }
        if (!append) setCandidates([]);
        return;
      }
      setCandidates((prev) =>
        append ? [...prev, ...(body.candidates ?? [])] : body.candidates ?? []
      );
      setHasNextPage(Boolean(body.pageInfo?.hasNextPage));
      setCursor(body.pageInfo?.endCursor ?? null);
    } catch {
      setError("Could not load Shopify products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null, false);
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
      void load(null, false);
    }
  }, [batch, load]);

  useEffect(() => {
    if (!batch || batch.state !== "COMPLETED") return;
    if (shownBulkNotice.current === batch.id) return;
    const lines = batch.failures
      .filter((failure) => failure.message.startsWith(METAFIELD_NOTICE_PREFIX))
      .map(
        (failure) =>
          `${failure.shopifyProductId.replace("gid://shopify/Product/", "Product ")}: ${metafieldLines(failure.message)}`
      );
    if (lines.length === 0) return;
    shownBulkNotice.current = batch.id;
    setMetafieldNotice({
      title: "Some Shopify metafields were not imported",
      lines,
    });
  }, [batch]);

  function openReview(candidate: Candidate) {
    if (!candidate.supported) return;
    setSelected(candidate);
    setStockMode(candidate.recommendedStockMode);
    setStep("review");
    setError(null);
  }

  async function onImport() {
    if (!selected || !stockMode) {
      setError("Needs stock-mode selection.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/shopify/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyProductId: selected.shopifyProductId,
          stockMode,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        storeItemId?: string;
        status?: string;
        incompatibleMetafields?: Array<{ name: string; typeLabel: string; reason: string }>;
      };
      if (!response.ok || !body.storeItemId) {
        setError(body.error ?? "Import failed. Refresh and try again.");
        return;
      }
      const href = `${APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}/${body.storeItemId}`;
      const skipped = body.incompatibleMetafields ?? [];
      if (skipped.length > 0) {
        setMetafieldNotice({
          title: `${selected.title} imported with metafields left off`,
          lines: skipped.map((field) => `${field.name} (${field.typeLabel}): ${field.reason}`),
          continueHref: href,
        });
        return;
      }
      router.push(href);
    } catch {
      setError("Import failed. Refresh and try again.");
    } finally {
      setImporting(false);
    }
  }

  async function onImportAll() {
    setBulkStarting(true);
    setError(null);
    setConnectionError(null);
    try {
      const response = await fetch("/api/shopify/import/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockModePolicy: bulkPolicy }),
      });
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        batch?: BatchProgress;
      };
      if (!response.ok || !body.batch) {
        if (body.code === "CONNECTION_REQUIRED" || body.code === "LOCATION_REQUIRED") {
          setConnectionError(body.error ?? "Finish Shopify connection setup first.");
        } else {
          setError(body.error ?? "Could not start bulk import.");
        }
        return;
      }
      setBatch(body.batch);
    } catch {
      setError("Could not start bulk import.");
    } finally {
      setBulkStarting(false);
    }
  }

  async function onCancelBulk() {
    setBulkCancelling(true);
    setError(null);
    try {
      const response = await fetch("/api/shopify/import/batch/cancel", {
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

  return (
    <AppsAirportChrome
      title="Import listings"
      subtitle="Bring Shopify products into INW — import all at once with progress, or review one at a time. Import does not publish them to other marketplaces."
      crumbs={[
        { href: APPS_AIRPORT_SHOPIFY_PATH, label: "Shopify" },
        { href: `${APPS_AIRPORT_SHOPIFY_PATH}/import`, label: "Import" },
      ]}
    >
      {connectionError ? (
        <div
          className="rounded-[10px] border-2 p-5 mb-6"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            {connectionError}
          </p>
          <Link href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH} className="btn mt-4 inline-block" prefetch={false}>
            Connection settings
          </Link>
        </div>
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
                        ? "Scanning your Shopify catalog…"
                        : "Importing from Shopify…"}
              </p>
              <p className="mt-1 text-sm text-neutral-600">
                {batch.scanning
                  ? "Finding products that are not linked yet."
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
          {batch.failures.some((f) => !f.message.startsWith(METAFIELD_NOTICE_PREFIX)) ? (
            <div className="mt-3 max-h-36 overflow-y-auto text-xs text-neutral-700">
              <p className="font-semibold text-neutral-800 mb-1">Recent failures</p>
              <ul className="space-y-1">
                {batch.failures
                  .filter((f) => !f.message.startsWith(METAFIELD_NOTICE_PREFIX))
                  .slice(-8)
                  .map((f) => (
                  <li key={`${f.shopifyProductId}-${f.message.slice(0, 24)}`}>
                    {f.shopifyProductId.replace("gid://shopify/Product/", "#")}: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(batch.state === "COMPLETED" || batch.state === "CANCELLED") && (
            <p className="mt-3 text-sm">
              <Link
                href="/seller-hub/store/items"
                className="underline font-medium"
                style={{ color: "var(--color-primary)" }}
                prefetch={false}
              >
                View my items
              </Link>
            </p>
          )}
        </div>
      ) : null}

      {step === "discover" ? (
        <>
          <div className="mb-6 rounded-[10px] border border-neutral-200 p-4">
            <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
              Import all products
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Import every unmapped Shopify product on this shop. Unsupported products are skipped
              with a reason. Progress and time remaining appear above.
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
                <span className="text-sm">
                  Recommended per product (tracked inventory → physical)
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="bulkPolicy"
                  checked={bulkPolicy === "PHYSICAL"}
                  onChange={() => setBulkPolicy("PHYSICAL")}
                />
                <span className="text-sm">All physical stock</span>
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
            <button
              type="button"
              className="btn mt-4"
              disabled={activeBulk || bulkStarting || Boolean(connectionError)}
              onClick={() => void onImportAll()}
              data-testid="shopify-import-all"
            >
              {bulkStarting
                ? "Starting…"
                : activeBulk
                  ? "Import running…"
                  : "Import all products"}
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              disabled={loading || activeBulk}
              onClick={() => void load(null, false)}
            >
              {loading ? "Loading…" : "Refresh products"}
            </button>
            <Link
              href="/seller-hub/store/items"
              className="text-sm underline self-center"
              prefetch={false}
              style={{ color: "var(--color-primary)" }}
            >
              My items
            </Link>
          </div>

          <p className="mb-4 text-sm text-neutral-600">
            Or review one product at a time to choose stock mode before importing.
          </p>

          {!loading && !connectionError && candidates.length === 0 ? (
            <p className="text-sm text-neutral-600" data-testid="shopify-import-empty">
              No unmapped Shopify products found on this page. Already-synced products stay hidden.
            </p>
          ) : null}

          {candidates.length > 0 ? (
            <div className="overflow-x-auto" data-testid="shopify-import-candidates">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                    <th className="py-2 pr-3 font-semibold">Title</th>
                    <th className="py-2 pr-3 font-semibold">Shopify status</th>
                    <th className="py-2 pr-3 font-semibold">Price</th>
                    <th className="py-2 pr-3 font-semibold">SKU</th>
                    <th className="py-2 pr-3 font-semibold">Inventory</th>
                    <th className="py-2 pr-3 font-semibold">Support</th>
                    <th className="py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((row) => (
                    <tr key={row.shopifyProductId} className="border-b border-neutral-200 align-top">
                      <td className="py-3 pr-3 font-medium">{row.title}</td>
                      <td className="py-3 pr-3">{row.status}</td>
                      <td className="py-3 pr-3">{formatCents(row.priceCents)}</td>
                      <td className="py-3 pr-3">{row.sku ?? "—"}</td>
                      <td className="py-3 pr-3">
                        {row.inventoryTracked == null
                          ? "—"
                          : row.inventoryTracked
                            ? `Tracked · ${row.primaryLocationAvailable ?? "—"} at location`
                            : "Not tracked"}
                      </td>
                      <td className="py-3 pr-3">
                        {row.supported ? (
                          <span className="text-green-800">Supported</span>
                        ) : (
                          <span className="text-amber-800">
                            Unsupported
                            {row.unsupportedReason ? ` — ${row.unsupportedReason}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          className="btn"
                          disabled={!row.supported || activeBulk}
                          onClick={() => openReview(row)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {hasNextPage ? (
            <button
              type="button"
              className="btn mt-4 border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              disabled={loading}
              onClick={() => void load(cursor, true)}
            >
              Load more
            </button>
          ) : null}
        </>
      ) : null}

      {step === "review" && selected ? (
        <div
          className="rounded-[10px] border-2 p-5 max-w-xl"
          style={{ borderColor: "var(--color-primary)" }}
          data-testid="shopify-import-review"
        >
          <h2 className="font-bold text-lg" style={{ color: "var(--color-heading)" }}>
            Review import
          </h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div>
              <dt className="text-neutral-500">Title</dt>
              <dd className="font-medium">{selected.title}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Shopify status</dt>
              <dd>{selected.status}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Price</dt>
              <dd>{formatCents(selected.priceCents)}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">SKU</dt>
              <dd>{selected.sku ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">Location quantity</dt>
              <dd>{selected.primaryLocationAvailable ?? "—"}</dd>
            </div>
          </dl>

          <fieldset className="mt-6">
            <legend className="font-semibold text-sm" style={{ color: "var(--color-heading)" }}>
              Stock mode
            </legend>
            <p className="mt-1 text-xs text-neutral-600">
              Recommendation is based on Shopify inventory tracking, but you choose the INW mode.
            </p>
            <label className="mt-3 flex gap-2 items-start text-sm">
              <input
                type="radio"
                name="stockMode"
                checked={stockMode === "PHYSICAL"}
                onChange={() => setStockMode("PHYSICAL")}
              />
              <span>
                <strong>Physical</strong> — use Shopify selected-location available quantity as opening
                stock.
              </span>
            </label>
            <label className="mt-2 flex gap-2 items-start text-sm">
              <input
                type="radio"
                name="stockMode"
                checked={stockMode === "MADE_TO_ORDER"}
                onChange={() => setStockMode("MADE_TO_ORDER")}
              />
              <span>
                <strong>Made to order</strong> — nonfinite INW inventory (no fake stock quantity).
              </span>
            </label>
          </fieldset>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn"
              disabled={importing || !stockMode || activeBulk}
              onClick={() => void onImport()}
              data-testid="shopify-import-confirm"
            >
              {importing ? "Importing…" : "Import to INW"}
            </button>
            <button
              type="button"
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              disabled={importing}
              onClick={() => {
                setStep("discover");
                setSelected(null);
              }}
            >
              Back to products
            </button>
          </div>
        </div>
      ) : null}
      {metafieldNotice ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shopify-metafield-notice-title"
          data-testid="shopify-metafield-notice"
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="shopify-metafield-notice-title" className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
              {metafieldNotice.title}
            </h2>
            <p className="mt-2 text-sm text-neutral-700">
              INW custom options match Etsy: a text box, one choice list, and one file upload.
              These Shopify metafields are not compatible, so they were not imported and will not sync to Etsy.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-neutral-800">
              {metafieldNotice.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button
              type="button"
              className="btn mt-5"
              onClick={() => {
                const href = metafieldNotice.continueHref;
                setMetafieldNotice(null);
                if (href) router.push(href);
              }}
            >
              {metafieldNotice.continueHref ? "Continue" : "Close"}
            </button>
          </div>
        </div>
      ) : null}
    </AppsAirportChrome>
  );
}
