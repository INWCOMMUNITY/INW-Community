"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import Script from "next/script";
import { ShippoElementsSurface } from "@/components/ShippoElementsModal";
import {
  useShippoBulkLabelFlow,
  SHIPPO_BULK_EMBEDDABLE_URL,
  isOrderEligibleForBulkShip,
  type StoreOrderForBulkLabel,
} from "@/hooks/use-shippo-bulk-label-flow";

const CONTAINER_ID = "shippo-elements-bulk-direct";

/**
 * App / deep-link entry: no storefront order list—load to-ship orders and open full-screen Shippo immediately.
 */
export default function ShippoBulkDirectPage() {
  const [orders, setOrders] = useState<StoreOrderForBulkLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const autoStartedRef = useRef(false);
  const runBulkFlowRef = useRef<(ids: string[]) => void>(() => {});

  const refetchSilent = useCallback(() => {
    fetch("/api/store-orders?mine=1&needsShipment=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return;
        if (Array.isArray(data)) setOrders(data as StoreOrderForBulkLabel[]);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    setFetchError(null);
    setLoading(true);
    fetch("/api/store-orders?mine=1&needsShipment=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setFetchError((data as { error?: string }).error ?? "Failed to load orders.");
          return [];
        }
        return Array.isArray(data) ? (data as StoreOrderForBulkLabel[]) : [];
      })
      .then(setOrders)
      .catch(() => {
        setFetchError("Connection failed.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const {
    elementsLoading,
    elementsError,
    setElementsError,
    shippoSurfaceOpen,
    closeShippoSurface,
    runBulkFlow,
    progressSubtitle,
  } = useShippoBulkLabelFlow({
    containerId: CONTAINER_ID,
    orders,
    onAfterSave: refetchSilent,
  });

  runBulkFlowRef.current = runBulkFlow;

  const eligibleCount = useMemo(() => orders.filter(isOrderEligibleForBulkShip).length, [orders]);

  useEffect(() => {
    if (loading || fetchError || autoStartedRef.current) return;
    autoStartedRef.current = true;

    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const raw = sp.get("bulkOrderIds");
    const requestedSet =
      raw && raw.trim().length > 0
        ? new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))
        : null;

    if (requestedSet && typeof window !== "undefined") {
      sp.delete("bulkOrderIds");
      const qs = sp.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
      );
    }

    let eligibleIds = orders.filter(isOrderEligibleForBulkShip).map((o) => o.id);
    if (requestedSet && requestedSet.size > 0) {
      eligibleIds = eligibleIds.filter((id) => requestedSet.has(id));
      if (eligibleIds.length === 0) {
        setElementsError("None of the selected orders are available to ship. Go back, refresh the list, and try again.");
        return;
      }
    }
    if (eligibleIds.length === 0) {
      setElementsError(null);
      return;
    }
    void runBulkFlowRef.current(eligibleIds);
  }, [loading, fetchError, orders, setElementsError]);

  const showIdleHint =
    !loading &&
    !fetchError &&
    !elementsError &&
    eligibleCount === 0 &&
    !shippoSurfaceOpen &&
    !elementsLoading;

  return (
    <div className="min-h-[50dvh] flex flex-col items-center justify-center px-4 py-8 text-center">
      <Script src={SHIPPO_BULK_EMBEDDABLE_URL} strategy="afterInteractive" />

      {fetchError && (
        <div className="max-w-md border rounded-lg p-6 bg-red-50 mb-4">
          <p className="text-red-700">{fetchError}</p>
          <Link href="/seller-hub/orders" className="btn text-sm mt-4 inline-block">
            Back to orders
          </Link>
        </div>
      )}

      {loading && !fetchError && (
        <p className="text-gray-500 text-sm" aria-live="polite">
          Opening shipping labels…
        </p>
      )}

      {showIdleHint && (
        <div className="max-w-md text-gray-600 text-sm space-y-4">
          <p>No orders ready to ship right now.</p>
          <Link href="/seller-hub/orders" className="text-[var(--color-link)] underline font-medium">
            View storefront orders
          </Link>
        </div>
      )}

      {elementsError && !shippoSurfaceOpen && (
        <div className="max-w-md mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
          {elementsError}
          <div className="mt-3">
            <Link href="/seller-hub/orders" className="underline font-medium" style={{ color: "var(--color-link)" }}>
              Back to orders
            </Link>
          </div>
        </div>
      )}

      <ShippoElementsSurface
        open={shippoSurfaceOpen}
        onClose={closeShippoSurface}
        containerId={CONTAINER_ID}
        title="Shippo — labels"
        presentation="page"
        subtitle={progressSubtitle}
      />
    </div>
  );
}
