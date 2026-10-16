"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { OnboardingImportBanner } from "@/components/seller-onboarding/OnboardingImportBanner";
import {
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  formatCents,
} from "@/lib/shopify/apps-airport";
import { parseSellerShippingDollars } from "@/lib/etsy/import-shipping";

type Candidate = {
  shopifyProductId: string;
  title: string;
  status: string;
  supported: boolean;
  unsupportedReason: string | null;
  priceCents: number | null;
  sku: string | null;
  imageUrl: string | null;
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

/** A finished import is not left on the page. A stopped import stays so the error is visible. */
function batchStaysOnScreen(batch: BatchProgress | null): boolean {
  return batch != null && batch.state !== "COMPLETED" && batch.state !== "CANCELLED";
}

function importBarPercent(batch: BatchProgress, nowMs: number): number {
  if (batch.state === "COMPLETED" || batch.state === "CANCELLED") return 100;
  if (batch.scanning) {
    const wave = (Math.sin(nowMs / 450) + 1) / 2;
    return 10 + wave * 22;
  }
  const total = Math.max(1, batch.total);
  const done = batch.processed;
  if (!batchIsActive(batch)) return batch.percent ?? Math.round((done / total) * 100);
  const anchor = batch.lastProgressAt ?? batch.startedAt;
  const elapsed = anchor ? Math.max(0, nowMs - new Date(anchor).getTime()) : 0;
  const itemMs = batch.avgItemMs && batch.avgItemMs > 0 ? batch.avgItemMs : 12_000;
  const slice = batch.remaining > 0 ? Math.min(0.9, elapsed / itemMs) : 0;
  return Math.min(99, ((done + slice) / total) * 100);
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
  const [step, setStep] = useState<"discover" | "review" | "shipping">("discover");
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [shippingItems, setShippingItems] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [priceById, setPriceById] = useState<Record<string, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [singleShippingPrice, setSingleShippingPrice] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
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
        shopDomain?: string | null;
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
      setShopDomain(body.shopDomain ?? null);
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
    if (!batchIsActive(batch)) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [batch]);

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
    setSingleShippingPrice("");
    setStep("review");
    setError(null);
  }

  function selectableCandidates(): Candidate[] {
    return candidates.filter((candidate) => candidate.supported);
  }

  function selectedCandidates(): Candidate[] {
    return selectableCandidates().filter((candidate) => selectedIds.has(candidate.shopifyProductId));
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
      const response = await fetch("/api/shopify/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopifyProductId: selected.shopifyProductId,
          stockMode,
          shippingCostCents: cents,
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

  async function onImportAll(priced?: { productIds: string[]; shippingPrices: Record<string, number> }) {
    setBulkStarting(true);
    setError(null);
    setConnectionError(null);
    try {
      const response = await fetch("/api/shopify/import/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockModePolicy: bulkPolicy,
          ...(priced
            ? { productIds: priced.productIds, shippingPrices: priced.shippingPrices }
            : {}),
        }),
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
      setStep("discover");
    } catch {
      setError("Could not start bulk import.");
    } finally {
      setBulkStarting(false);
    }
  }

  function openShippingPage() {
    const chosen = selectedCandidates();
    if (chosen.length === 0) {
      setError("Select the listings to import.");
      return;
    }
    setError(null);
    setShippingItems(chosen);
    setCheckedIds(new Set());
    setPriceById({});
    setBulkPrice("");
    setStep("shipping");
  }

  function shipFree(items: Candidate[]) {
    if (items.length === 0) {
      setError("Select the listings to import.");
      return;
    }
    const shippingPrices: Record<string, number> = {};
    for (const item of items) shippingPrices[item.shopifyProductId] = 0;
    void onImportAll({
      productIds: items.map((item) => item.shopifyProductId),
      shippingPrices,
    });
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
      const cents = parseSellerShippingDollars(priceById[item.shopifyProductId] ?? "");
      if (cents == null) {
        setError("Enter a shipping price for every listing, or ship for free.");
        return;
      }
      shippingPrices[item.shopifyProductId] = cents;
    }
    void onImportAll({
      productIds: shippingItems.map((item) => item.shopifyProductId),
      shippingPrices,
    });
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
      title="Import from Shopify"
      subtitle="Bring Shopify products into INW. Import does not publish them to Etsy or other marketplaces."
      crumbs={[
        { href: APPS_AIRPORT_SHOPIFY_PATH, label: "Shopify" },
        { href: `${APPS_AIRPORT_SHOPIFY_PATH}/import`, label: "Import" },
      ]}
    >
      <OnboardingImportBanner />
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

      {batchStaysOnScreen(batch) && batch ? (
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
                className="btn btn-pill-primary text-sm"
                disabled={bulkCancelling || batch.cancelRequested}
                onClick={() => void onCancelBulk()}
              >
                {batch.cancelRequested || bulkCancelling ? "Cancelling…" : "Cancel import"}
              </button>
            ) : null}
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${importBarPercent(batch, nowMs)}%`,
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
              Choose listings to import
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              {`Check the listings you want${
                selectableCandidates().length > 0
                  ? ` (${selectableCandidates().length} ready to import)`
                  : ""
              }. The next page sets a shipping price for each one. Ship for free to import the checked listings now.`}
            </p>
            <p className="mt-2 text-sm text-neutral-600">INW does not sync shipping prices.</p>
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
          </div>

          <p className="mb-4 text-sm text-neutral-600">
            Or open Review on one listing to choose its stock mode and shipping price.
          </p>
          {shopDomain ? (
            <p className="mb-3 text-sm text-neutral-600">Shop: {shopDomain}.</p>
          ) : null}
          {loading && candidates.length === 0 ? (
            <p className="text-sm text-neutral-600">Loading…</p>
          ) : null}
          {candidates.length > 0 ? (
            <div className="overflow-x-auto rounded-[10px] border border-neutral-200" data-testid="shopify-import-candidates">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 text-left">
                  <tr>
                    <th className="px-3 py-2 w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all listings"
                        checked={
                          selectableCandidates().length > 0 &&
                          selectedIds.size === selectableCandidates().length
                        }
                        onChange={(e) => {
                          setSelectedIds(
                            e.target.checked
                              ? new Set(selectableCandidates().map((candidate) => candidate.shopifyProductId))
                              : new Set()
                          );
                        }}
                      />
                    </th>
                    <th className="px-3 py-2">Listing</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.shopifyProductId} className="border-t border-neutral-100">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${candidate.title}`}
                          disabled={!candidate.supported || activeBulk}
                          checked={selectedIds.has(candidate.shopifyProductId)}
                          onChange={(e) => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(candidate.shopifyProductId);
                              else next.delete(candidate.shopifyProductId);
                              return next;
                            });
                          }}
                        />
                      </td>
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
                          <span className="min-w-0">
                            <span className="block truncate">{candidate.title}</span>
                            {!candidate.supported ? (
                              <span className="block text-xs text-amber-800">
                                Unsupported
                                {candidate.unsupportedReason ? ` — ${candidate.unsupportedReason}` : ""}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">{candidate.status}</td>
                      <td className="px-3 py-2">{formatCents(candidate.priceCents)}</td>
                      <td className="px-3 py-2">{candidate.primaryLocationAvailable ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="btn"
                          disabled={!candidate.supported || activeBulk}
                          onClick={() => openReview(candidate)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !loading && !connectionError ? (
            <p className="text-sm text-neutral-600" data-testid="shopify-import-empty">
              No unmapped Shopify products found on this page. Already-synced products stay hidden.
            </p>
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
          {candidates.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn"
                disabled={activeBulk || bulkStarting || Boolean(connectionError)}
                onClick={openShippingPage}
                data-testid="shopify-import-set-shipping"
              >
                Set Shipping Prices
              </button>
              <button
                type="button"
                className="btn btn-pill-earth"
                disabled={activeBulk || bulkStarting || Boolean(connectionError)}
                onClick={() => shipFree(selectedCandidates())}
                data-testid="shopify-import-ship-free"
              >
                {bulkStarting ? "Starting…" : activeBulk ? "Import Running…" : "Ship for Free with INW (Appreciated)"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {step === "shipping" ? (
        <div className="space-y-4" data-testid="shopify-import-shipping">
          <div>
            <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
              Shipping prices
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              Set what buyers pay to ship each listing on INW. Check listings to apply one price to all of them.
              INW does not sync shipping prices.
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
                      ? new Set(shippingItems.map((item) => item.shopifyProductId))
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
                  <tr key={item.shopifyProductId} className="border-t border-neutral-100">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        checked={checkedIds.has(item.shopifyProductId)}
                        onChange={(e) => {
                          setCheckedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(item.shopifyProductId);
                            else next.delete(item.shopifyProductId);
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
                          value={priceById[item.shopifyProductId] ?? ""}
                          onChange={(e) =>
                            setPriceById((prev) => ({
                              ...prev,
                              [item.shopifyProductId]: e.target.value,
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
              onClick={() => shipFree(shippingItems)}
            >
              Ship for Free with INW (Appreciated)
            </button>
            <button
              type="button"
              className="btn btn-pill-primary"
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

      {step === "review" && selected ? (
        <div className="max-w-lg space-y-4" data-testid="shopify-import-review">
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
                {formatCents(selected.priceCents)} · qty {selected.primaryLocationAvailable ?? "—"}
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
            <span className="mt-1 block text-neutral-600">INW does not sync shipping prices.</span>
          </label>
          <div className="flex flex-wrap gap-3">
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
              className="btn btn-pill-earth"
              disabled={importing || !stockMode || activeBulk}
              onClick={() => void onImport(0)}
            >
              Ship for Free with INW (Appreciated)
            </button>
            <button
              type="button"
              className="btn btn-pill-primary"
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
