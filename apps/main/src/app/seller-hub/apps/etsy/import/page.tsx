"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_ETSY_PATH,
  APPS_AIRPORT_ETSY_SETTINGS_PATH,
  formatEtsyCents,
} from "@/lib/etsy/apps-airport";

type Candidate = {
  etsyListingId: string;
  title: string;
  state: string;
  supported: boolean;
  unsupportedReason: string | null;
  priceCents: number | null;
  quantity: number | null;
  sku: string | null;
  recommendedStockMode: "PHYSICAL" | "MADE_TO_ORDER" | null;
};

type StockMode = "PHYSICAL" | "MADE_TO_ORDER";

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
  const [step, setStep] = useState<"discover" | "review">("discover");

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
  }, [load]);

  async function openReview(candidate: Candidate) {
    setError(null);
    setReviewLoading(true);
    setStep("review");
    setSelected(null);
    setStockMode(null);
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

  async function onImport() {
    if (!selected || !stockMode) {
      setError("Choose a stock mode before importing.");
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
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        storeItemId?: string;
        status?: string;
        code?: string;
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
      router.push(`${APPS_AIRPORT_ETSY_PATH}?imported=${encodeURIComponent(body.storeItemId)}`);
    } catch {
      setError("Import failed.");
    } finally {
      setImporting(false);
    }
  }

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

      {step === "discover" ? (
        <>
          <p className="mb-4 text-sm text-neutral-600">
            Showing active Etsy listings that are not linked to INW yet. Select one to review stock
            mode and import.
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
                      <td className="px-3 py-2">{candidate.title}</td>
                      <td className="px-3 py-2">{candidate.state}</td>
                      <td className="px-3 py-2">{formatEtsyCents(candidate.priceCents)}</td>
                      <td className="px-3 py-2">{candidate.quantity ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="btn"
                          disabled={reviewLoading}
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

      {step === "review" ? (
        <div className="max-w-lg space-y-4">
          {reviewLoading ? <p className="text-sm text-neutral-600">Loading listing details…</p> : null}
          {selected ? (
            <>
              <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
                {selected.title}
              </p>
              <p className="text-sm text-neutral-600">
                {formatEtsyCents(selected.priceCents)} · qty {selected.quantity ?? "—"}
              </p>
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
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="btn"
                  disabled={importing || !stockMode}
                  onClick={() => void onImport()}
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
    </AppsAirportChrome>
  );
}
