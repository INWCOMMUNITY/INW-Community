"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  APPS_AIRPORT_WIX_PATH,
  APPS_AIRPORT_WIX_SETTINGS_PATH,
  formatWixCents,
} from "@/lib/wix/apps-airport";

type Candidate = {
  wixProductId: string;
  name: string;
  price: number;
  currency: string;
  photos: string[];
  visible: boolean;
  hasVariants: boolean;
  variantCount: number;
  totalQuantity: number | null;
  sku: string | null;
  alreadyLinked: boolean;
  linkedStoreItemId: string | null;
};

type StockMode = "PHYSICAL" | "MADE_TO_ORDER";

export default function AppsAirportWixImportPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [stockMode, setStockMode] = useState<StockMode>("PHYSICAL");
  const [importing, setImporting] = useState(false);
  const [step, setStep] = useState<"discover" | "review">("discover");

  const load = useCallback(async (nextCursor?: string | null, append = false) => {
    setLoading(true);
    setError(null);
    setConnectionError(null);
    try {
      const qs = new URLSearchParams();
      if (nextCursor) qs.set("cursor", nextCursor);
      qs.set("limit", "50");
      const response = await fetch(`/api/wix/import/candidates?${qs}`, {
        credentials: "include",
      });
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        candidates?: Candidate[];
        hasMore?: boolean;
        nextCursor?: string | null;
      };
      if (!response.ok) {
        if (response.status === 404 || body.code === "CONNECTION_REQUIRED") {
          setConnectionError(body.error ?? "Connect Wix first.");
        } else if (body.code === "PERMISSION" || body.code === "TOKEN") {
          setConnectionError(
            body.error ??
              "Wix did not allow reading products. Reconnect Wix and confirm Read Products permission."
          );
        } else {
          setError(body.error ?? "Could not load Wix products.");
        }
        if (!append) setCandidates([]);
        return;
      }
      const next = (body.candidates ?? []).filter((c) => !c.alreadyLinked);
      setCandidates((prev) => (append ? [...prev, ...next] : next));
      setHasMore(Boolean(body.hasMore));
      setCursor(body.nextCursor ?? null);
    } catch {
      setError("Could not load Wix products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null, false);
  }, [load]);

  function openReview(candidate: Candidate) {
    setSelected(candidate);
    setStockMode("PHYSICAL");
    setStep("review");
    setError(null);
  }

  async function onImport() {
    if (!selected) return;
    setImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/wix/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wixProductId: selected.wixProductId,
          stockMode,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        storeItemId?: string;
        status?: string;
      };
      if (!response.ok || !body.storeItemId) {
        if (response.status === 404) {
          setConnectionError(body.error ?? "Connect Wix first.");
        } else {
          setError(body.error ?? "Import failed.");
        }
        return;
      }
      router.push(`${APPS_AIRPORT_WIX_PATH}?imported=${encodeURIComponent(body.storeItemId)}`);
    } catch {
      setError("Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppsAirportChrome
      title="Import from Wix"
      subtitle="Bring Wix products into INW. Import does not publish them to other marketplaces."
      crumbs={[
        { href: APPS_AIRPORT_WIX_PATH, label: "Wix" },
        { href: `${APPS_AIRPORT_WIX_PATH}/import`, label: "Import" },
      ]}
    >
      {connectionError ? (
        <p className="mb-4 text-sm text-amber-800">
          {connectionError}{" "}
          <Link
            href={APPS_AIRPORT_WIX_SETTINGS_PATH}
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
            Showing Wix products that are not linked to INW yet. Select one to choose stock mode and
            import.
          </p>
          {loading && candidates.length === 0 ? (
            <p className="text-sm text-neutral-600">Loading products…</p>
          ) : error || connectionError ? null : candidates.length === 0 ? (
            <p className="text-sm text-neutral-600">No unlinked Wix products found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                    <th className="py-2 pr-3 font-semibold">Product</th>
                    <th className="py-2 pr-3 font-semibold">Price</th>
                    <th className="py-2 pr-3 font-semibold">Qty</th>
                    <th className="py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => (
                    <tr key={candidate.wixProductId} className="border-b border-neutral-200">
                      <td className="py-3 pr-3">
                        <div className="font-medium">{candidate.name}</div>
                        {candidate.sku ? (
                          <div className="text-xs text-neutral-500">SKU {candidate.sku}</div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        {formatWixCents(Math.round((candidate.price ?? 0) * 100))}
                      </td>
                      <td className="py-3 pr-3">{candidate.totalQuantity ?? "—"}</td>
                      <td className="py-3">
                        <button type="button" className="btn text-sm py-1.5 px-3" onClick={() => openReview(candidate)}>
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hasMore ? (
            <button
              type="button"
              className="btn mt-4"
              disabled={loading}
              onClick={() => void load(cursor, true)}
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      ) : (
        <div className="max-w-lg space-y-4">
          <button
            type="button"
            className="text-sm underline"
            style={{ color: "var(--color-primary)" }}
            onClick={() => {
              setStep("discover");
              setSelected(null);
            }}
          >
            ← Back to products
          </button>
          {selected ? (
            <>
              <h2 className="font-semibold" style={{ color: "var(--color-heading)" }}>
                {selected.name}
              </h2>
              <p className="text-sm text-neutral-600">
                Choose how inventory should work on INW after import.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="stockMode"
                  checked={stockMode === "PHYSICAL"}
                  onChange={() => setStockMode("PHYSICAL")}
                />
                <span>Physical stock — track quantity from Wix</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="stockMode"
                  checked={stockMode === "MADE_TO_ORDER"}
                  onChange={() => setStockMode("MADE_TO_ORDER")}
                />
                <span>Made to order — no finite quantity</span>
              </label>
              <button type="button" className="btn" disabled={importing} onClick={() => void onImport()}>
                {importing ? "Importing…" : "Import to INW"}
              </button>
            </>
          ) : null}
        </div>
      )}
    </AppsAirportChrome>
  );
}
