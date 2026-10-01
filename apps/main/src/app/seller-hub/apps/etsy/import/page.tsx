"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_ETSY_PATH,
  APPS_AIRPORT_ETSY_SETTINGS_PATH,
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

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function AppsAirportEtsyImportPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [stockMode, setStockMode] = useState<StockMode | null>(null);
  const [importing, setImporting] = useState(false);
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
        pageInfo?: { hasNextPage?: boolean; offset?: number };
      };
      if (!response.ok) {
        if (body.code === "CONNECTION_REQUIRED") {
          setConnectionError(body.error ?? "Connect Etsy first.");
        } else {
          setError(body.error ?? "Could not load Etsy listings.");
        }
        if (!append) setCandidates([]);
        return;
      }
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

  function openReview(candidate: Candidate) {
    setSelected(candidate);
    setStockMode(candidate.recommendedStockMode ?? "PHYSICAL");
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
      };
      if (!response.ok || !body.storeItemId) {
        setError(body.error ?? "Import failed.");
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
            Connection settings
          </Link>
        </p>
      ) : null}
      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {step === "discover" ? (
        <>
          <p className="mb-4 text-sm text-neutral-600">
            Showing active Etsy listings that are not mapped yet. Select one to review stock mode and
            import.
          </p>
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
                      <td className="px-3 py-2">{formatCents(candidate.priceCents)}</td>
                      <td className="px-3 py-2">{candidate.quantity ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button type="button" className="btn" onClick={() => openReview(candidate)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !loading ? (
            <p className="text-sm text-neutral-600">No unmapped active listings found.</p>
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
      ) : (
        <div className="max-w-lg">
          <button
            type="button"
            className="mb-4 text-sm underline"
            style={{ color: "var(--color-primary)" }}
            onClick={() => setStep("discover")}
          >
            ← Back to listings
          </button>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-heading)" }}>
            {selected?.title}
          </h2>
          <p className="mt-2 text-sm text-neutral-600">
            Choose how INW should track inventory for this imported listing.
          </p>
          <div className="mt-4 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="stockMode"
                checked={stockMode === "PHYSICAL"}
                onChange={() => setStockMode("PHYSICAL")}
              />
              Physical (tracked quantity)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="stockMode"
                checked={stockMode === "MADE_TO_ORDER"}
                onChange={() => setStockMode("MADE_TO_ORDER")}
              />
              Made to order (no stock decrement)
            </label>
          </div>
          <button
            type="button"
            className="btn mt-6"
            disabled={importing || !stockMode}
            onClick={() => void onImport()}
          >
            {importing ? "Importing…" : "Import to INW"}
          </button>
        </div>
      )}
    </AppsAirportChrome>
  );
}
