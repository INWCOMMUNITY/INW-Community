"use client";

import { useCallback, useEffect, useState } from "react";
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
  }, [load]);

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
      };
      if (!response.ok || !body.storeItemId) {
        setError(body.error ?? "Import failed. Refresh and try again.");
        return;
      }
      router.push(`${APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}/${body.storeItemId}`);
    } catch {
      setError("Import failed. Refresh and try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppsAirportChrome
      title="Import listings"
      subtitle="Bring one simple Shopify product into INW at a time. Multi-variant products are shown as unsupported."
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

      {step === "discover" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
              style={{ color: "var(--color-heading)" }}
              disabled={loading}
              onClick={() => void load(null, false)}
            >
              {loading ? "Loading…" : "Refresh products"}
            </button>
            <Link
              href={APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}
              className="text-sm underline self-center"
              prefetch={false}
              style={{ color: "var(--color-primary)" }}
            >
              Synced listings
            </Link>
          </div>

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
                          disabled={!row.supported}
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
              disabled={importing || !stockMode}
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
    </AppsAirportChrome>
  );
}
