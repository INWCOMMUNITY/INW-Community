"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { ShippoElementsSurface } from "@/components/ShippoElementsModal";
import { CollapsibleHelpSection } from "@/components/fulfillment/CollapsibleHelpSection";
import { DeliveryQueueSection, countPendingDeliveryOrders } from "@/components/fulfillment/DeliveryQueueSection";
import { FulfillmentActionBar } from "@/components/fulfillment/FulfillmentActionBar";
import { FulfillmentTabBar } from "@/components/fulfillment/FulfillmentTabBar";
import { HistoryOrderSection } from "@/components/fulfillment/HistoryOrderSection";
import { OrderCard } from "@/components/fulfillment/OrderCard";
import { OrderEmptyState } from "@/components/fulfillment/OrderEmptyState";
import { PickupQueueSection, countPickupOrders } from "@/components/fulfillment/PickupQueueSection";
import { ShippoConnectionBanner } from "@/components/fulfillment/ShippoConnectionBanner";
import type { FulfillmentStoreOrder, SellerProfileForSlips } from "@/components/fulfillment/types";
import {
  useShippoBulkLabelFlow,
  SHIPPO_BULK_EMBEDDABLE_URL,
  type StoreOrderForBulkLabel,
} from "@/hooks/use-shippo-bulk-label-flow";
import { getErrorMessage } from "@/lib/api-error";
import {
  isOrderEligibleForToShipQueue,
  type FulfillmentTabKey,
} from "@/lib/store-order-fulfillment";

const SHIPPO_BULK_CONTAINER_ID = "shippo-elements-bulk-storefront-orders";
const SELECTION_STORAGE_KEY = "fulfillment-hub-ship-selection";

function parseTabParam(value: string | null): FulfillmentTabKey {
  if (value === "pickups" || value === "deliveries" || value === "history" || value === "ship") {
    return value;
  }
  return "ship";
}

export function FulfillmentHubContent(props: {
  backHref: string;
  backLabel: string;
  title: string;
  ordersBasePath: string;
  shippingSetupHref: string;
  loginCallbackUrl: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = parseTabParam(searchParams?.get("tab") ?? null);

  const [shipOrders, setShipOrders] = useState<FulfillmentStoreOrder[]>([]);
  const [allOrders, setAllOrders] = useState<FulfillmentStoreOrder[]>([]);
  const [shippedOrders, setShippedOrders] = useState<FulfillmentStoreOrder[]>([]);
  const [canceledOrders, setCanceledOrders] = useState<FulfillmentStoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [sellerProfile, setSellerProfile] = useState<SellerProfileForSlips | null>(null);
  const [shippingConnected, setShippingConnected] = useState<boolean | null>(null);
  const [markingShippedId, setMarkingShippedId] = useState<string | null>(null);
  const [shipActionError, setShipActionError] = useState<string | null>(null);
  const autoBulkStartedRef = useRef(false);
  const runBulkFlowRef = useRef<(ids: string[]) => void>(() => {});

  const toShipOrders = useMemo(
    () => shipOrders.filter(isOrderEligibleForToShipQueue),
    [shipOrders]
  );

  const tabCounts = useMemo(
    () => ({
      ship: toShipOrders.length,
      pickups: countPickupOrders(allOrders),
      deliveries: countPendingDeliveryOrders(allOrders),
      shipped: shippedOrders.length,
      canceled: canceledOrders.length,
    }),
    [toShipOrders, allOrders, shippedOrders, canceledOrders]
  );

  const [apiCounts, setApiCounts] = useState<Partial<typeof tabCounts> | null>(null);

  useEffect(() => {
    fetch("/api/store-orders?mine=1&counts=1")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object" && "toShip" in data) {
          setApiCounts({
            ship: Number((data as { toShip?: number }).toShip) || 0,
            pickups: Number((data as { pickups?: number }).pickups) || 0,
            deliveries: Number((data as { deliveries?: number }).deliveries) || 0,
            shipped: Number((data as { shipped?: number }).shipped) || 0,
            canceled: Number((data as { canceled?: number }).canceled) || 0,
          });
        }
      })
      .catch(() => {});
  }, [tab]);

  const displayCounts = apiCounts ?? tabCounts;

  const ordersForBulk = useMemo(
    (): StoreOrderForBulkLabel[] => (tab === "ship" ? (toShipOrders as StoreOrderForBulkLabel[]) : []),
    [tab, toShipOrders]
  );

  const refetchToShipSilent = useCallback(() => {
    fetch("/api/store-orders?mine=1&needsShipment=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return;
        if (Array.isArray(data)) setShipOrders(data as FulfillmentStoreOrder[]);
      })
      .catch(() => {});
  }, []);

  const {
    elementsLoading,
    elementsError,
    setElementsError,
    shippoSurfaceOpen,
    closeShippoSurface,
    runBulkFlow,
    progressSubtitle,
  } = useShippoBulkLabelFlow({
    containerId: SHIPPO_BULK_CONTAINER_ID,
    orders: ordersForBulk,
    onAfterSave: refetchToShipSilent,
  });

  runBulkFlowRef.current = runBulkFlow;

  const setTab = useCallback(
    (next: FulfillmentTabKey) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "ship") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(`${pathname ?? "/seller-hub/orders"}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("nwAppShippo") !== "bulk" && sp.get("autoBulk") !== "1") return;
    setTab("ship");
  }, [setTab]);

  useEffect(() => {
    setFetchError(null);
    setLoading(true);

    const fetches: Promise<void>[] = [];

    if (tab === "ship") {
      fetches.push(
        fetch("/api/store-orders?mine=1&needsShipment=1")
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
              setFetchError((data as { error?: string }).error ?? "Failed to load orders.");
              setShipOrders([]);
              return;
            }
            setShipOrders(Array.isArray(data) ? data : []);
          })
          .catch(() => {
            setFetchError("Connection failed.");
            setShipOrders([]);
          })
      );
    }

    if (tab === "pickups" || tab === "deliveries") {
      fetches.push(
        fetch("/api/store-orders?mine=1")
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
              setFetchError((data as { error?: string }).error ?? "Failed to load orders.");
              setAllOrders([]);
              return;
            }
            setAllOrders(Array.isArray(data) ? data : []);
          })
          .catch(() => {
            setFetchError("Connection failed.");
            setAllOrders([]);
          })
      );
    }

    if (tab === "history") {
      fetches.push(
        Promise.all([
          fetch("/api/store-orders?mine=1&shipped=1").then((r) => r.json()),
          fetch("/api/store-orders?mine=1&canceled=1").then((r) => r.json()),
        ])
          .then(([shipped, canceled]) => {
            setShippedOrders(Array.isArray(shipped) ? shipped : []);
            setCanceledOrders(Array.isArray(canceled) ? canceled : []);
          })
          .catch(() => {
            setShippedOrders([]);
            setCanceledOrders([]);
          })
      );
    }

    // Preload counts for tab badges on ship tab
    if (tab === "ship") {
      fetches.push(
        fetch("/api/store-orders?mine=1")
          .then((r) => r.json())
          .then((data) => {
            if (Array.isArray(data)) setAllOrders(data);
          })
          .catch(() => {})
      );
      fetches.push(
        Promise.all([
          fetch("/api/store-orders?mine=1&shipped=1").then((r) => r.json()),
          fetch("/api/store-orders?mine=1&canceled=1").then((r) => r.json()),
        ])
          .then(([shipped, canceled]) => {
            if (Array.isArray(shipped)) setShippedOrders(shipped);
            if (Array.isArray(canceled)) setCanceledOrders(canceled);
          })
          .catch(() => {})
      );
    }

    Promise.all(fetches).finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab !== "ship" || loading) return;
    const sp = new URLSearchParams(window.location.search);
    const bulk = sp.get("nwAppShippo") === "bulk" || sp.get("autoBulk") === "1";
    if (!bulk || autoBulkStartedRef.current) return;
    autoBulkStartedRef.current = true;
    sp.delete("nwAppShippo");
    sp.delete("autoBulk");
    sp.delete("nwAppChrome");
    const qs = sp.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    const eligibleIds = toShipOrders.map((o) => o.id);
    if (eligibleIds.length === 0) {
      setElementsError("No orders to ship.");
      return;
    }
    void runBulkFlowRef.current(eligibleIds);
  }, [tab, loading, toShipOrders, setElementsError]);

  useEffect(() => {
    if (tab !== "ship") {
      setShippingConnected(null);
      return;
    }
    if (toShipOrders.length === 0) {
      fetch("/api/shipping/status")
        .then((r) => r.json().catch(() => ({})))
        .then((data: { connected?: boolean }) => setShippingConnected(!!data.connected))
        .catch(() => setShippingConnected(false));
      return;
    }
    fetch("/api/shipping/status")
      .then((r) => r.json().catch(() => ({})))
      .then((data: { connected?: boolean }) => setShippingConnected(!!data.connected))
      .catch(() => setShippingConnected(false));
  }, [tab, toShipOrders.length]);

  useEffect(() => {
    if (tab !== "ship") return;
    fetch("/api/seller-profile")
      .then((r) => r.json())
      .then((data) => {
        const biz = data.business;
        setSellerProfile({
          business: biz
            ? {
                name: biz.name ?? null,
                phone: biz.phone ?? null,
                address: biz.address ?? null,
                city: biz.city ?? null,
                logoUrl: biz.logoUrl ?? null,
                website: biz.website ?? null,
                email: biz.email ?? null,
              }
            : null,
          returnAddressFormatted: data.returnAddressFormatted ?? null,
          packingSlipNote: data.packingSlipNote ?? null,
        });
      })
      .catch(() => setSellerProfile(null));
  }, [tab]);

  useEffect(() => {
    if (tab !== "ship" || typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(SELECTION_STORAGE_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids)) {
        setSelectedOrderIds(new Set(ids.filter((id) => toShipOrders.some((o) => o.id === id))));
      }
    } catch {
      /* ignore */
    }
  }, [tab, toShipOrders]);

  useEffect(() => {
    if (tab !== "ship" || typeof window === "undefined") return;
    sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(Array.from(selectedOrderIds)));
  }, [tab, selectedOrderIds]);

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function selectAllToShip() {
    setSelectedOrderIds(new Set(toShipOrders.map((o) => o.id)));
  }

  function clearSelection() {
    setSelectedOrderIds(new Set());
  }

  const selectedIdsArray = useMemo(() => Array.from(selectedOrderIds), [selectedOrderIds]);
  const selectedOrders = toShipOrders.filter((o) => selectedOrderIds.has(o.id));
  const sameBuyer =
    selectedOrders.length <= 1 ||
    selectedOrders.every((o) => o.buyer?.email === selectedOrders[0]?.buyer?.email);

  const printSlips = () => {
    window.print();
  };

  async function markShipped(orderId: string) {
    if (!window.confirm("Mark this order as shipped without buying a label here?")) return;
    setMarkingShippedId(orderId);
    setShipActionError(null);
    try {
      const res = await fetch(`/api/store-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "shipped" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setShipActionError(getErrorMessage(data.error, "Could not mark shipped."));
        return;
      }
      setShipOrders((prev) => prev.filter((o) => o.id !== orderId));
      setSelectedOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    } finally {
      setMarkingShippedId(null);
    }
  }

  const showStickyBar = tab === "ship" && selectedOrderIds.size > 0;

  return (
    <section
      className="py-12 px-4"
      style={{ padding: "var(--section-padding)", paddingBottom: showStickyBar ? "6rem" : undefined }}
    >
      {elementsLoading || shippoSurfaceOpen ? (
        <Script src={SHIPPO_BULK_EMBEDDABLE_URL} strategy="afterInteractive" />
      ) : null}
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href={props.backHref} className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          {props.backLabel}
        </Link>
        <h1 className="text-2xl font-bold mb-1">{props.title}</h1>
        <p className="text-sm text-gray-600 mb-4">Manage ship, pickup, and local delivery in one place.</p>

        <FulfillmentTabBar activeTab={tab} onTabChange={setTab} counts={displayCounts} />

        {fetchError ? (
          <div className="border rounded-lg p-6 bg-red-50 mb-6">
            <p className="text-red-700">{fetchError}</p>
            {fetchError.toLowerCase().includes("sign in") ? (
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(props.loginCallbackUrl)}`}
                className="btn mt-4 inline-block"
              >
                Sign in
              </Link>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : tab === "ship" ? (
          <>
            {(elementsError || shipActionError) && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                {elementsError || shipActionError}
              </div>
            )}

            <ShippoConnectionBanner
              connected={shippingConnected}
              shippingSetupHref={props.shippingSetupHref}
              orderCount={toShipOrders.length}
            />

            {toShipOrders.length === 0 ? (
              <OrderEmptyState tab="ship" />
            ) : (
              <ul className="space-y-3 mb-8">
                {toShipOrders.map((order) => (
                  <li key={order.id}>
                    <OrderCard
                      order={order}
                      ordersBasePath={props.ordersBasePath}
                      selectable={shippingConnected === true}
                      selected={selectedOrderIds.has(order.id)}
                      onToggleSelect={toggleOrderSelection}
                      onMarkShipped={markShipped}
                      markingShipped={markingShippedId === order.id}
                    />
                  </li>
                ))}
              </ul>
            )}

            {selectedOrders.length > 0 && sellerProfile ? (
              <div className="sr-only print:not-sr-only fixed -left-[9999px] print:static print:left-auto">
                <PackingSlipPrint
                  orders={selectedOrders.map((o) => ({
                    ...o,
                    shippingCostCents: o.shippingCostCents ?? 0,
                    shippingAddress: o.shippingAddress ?? {},
                    items: (o.items ?? []).map((item) => ({
                      ...item,
                      priceCentsAtPurchase: item.priceCentsAtPurchase ?? 0,
                    })),
                  }))}
                  sellerProfile={sellerProfile}
                  combined={selectedOrders.length > 1 && sameBuyer}
                />
              </div>
            ) : null}

            <div className="mt-8">
              <CollapsibleHelpSection shippingSetupHref={props.shippingSetupHref} />
            </div>

            <FulfillmentActionBar
              selectedCount={selectedOrderIds.size}
              totalCount={toShipOrders.length}
              elementsLoading={elementsLoading}
              shippoSurfaceOpen={shippoSurfaceOpen}
              shippingConnected={shippingConnected}
              onPurchaseLabels={() => void runBulkFlow(selectedIdsArray)}
              onPrintSlips={printSlips}
              onSelectAll={selectAllToShip}
              onClearSelection={clearSelection}
              slipsDisabled={!sellerProfile}
            />
          </>
        ) : tab === "pickups" ? (
          <PickupQueueSection
            orders={allOrders}
            ordersBasePath={props.ordersBasePath}
            onOrderUpdated={(updated) =>
              setAllOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
            }
          />
        ) : tab === "deliveries" ? (
          <DeliveryQueueSection
            orders={allOrders}
            ordersBasePath={props.ordersBasePath}
            onOrderUpdated={(updated) =>
              setAllOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
            }
            onOrderRemoved={(orderId) => setAllOrders((prev) => prev.filter((o) => o.id !== orderId))}
          />
        ) : (
          <HistoryOrderSection
            shippedOrders={shippedOrders}
            canceledOrders={canceledOrders}
            ordersBasePath={props.ordersBasePath}
          />
        )}
      </div>

      <ShippoElementsSurface
        open={shippoSurfaceOpen}
        onClose={closeShippoSurface}
        containerId={SHIPPO_BULK_CONTAINER_ID}
        title="Shippo — labels"
        presentation="page"
        subtitle={progressSubtitle}
      />
    </section>
  );
}
