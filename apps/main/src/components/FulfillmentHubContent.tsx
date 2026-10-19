"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { ShippoElementsSurface, ShippoPrintLabelActions } from "@/components/ShippoElementsModal";
import { CollapsibleHelpSection } from "@/components/fulfillment/CollapsibleHelpSection";
import { DeliveryQueueSection, countPendingDeliveryOrders } from "@/components/fulfillment/DeliveryQueueSection";
import { FulfillmentActionBar } from "@/components/fulfillment/FulfillmentActionBar";
import { FulfillmentTabBar } from "@/components/fulfillment/FulfillmentTabBar";
import { HistoryOrderSection, ShippedOrderSection } from "@/components/fulfillment/HistoryOrderSection";
import { CombinedOrderCard, OrderCard } from "@/components/fulfillment/OrderCard";
import { EtsyPersonalizationNotes } from "@/components/EtsyPersonalizationNotes";
import { OrderEmptyState } from "@/components/fulfillment/OrderEmptyState";
import { ShippoConnectionBanner } from "@/components/fulfillment/ShippoConnectionBanner";
import type { FulfillmentStoreOrder, SellerProfileForSlips } from "@/components/fulfillment/types";
import {
  packingSlipGroupsForSelection,
  purchaseGroupsForSelection,
  useShippoBulkLabelFlow,
  SHIPPO_BULK_EMBEDDABLE_URL,
  type StoreOrderForBulkLabel,
} from "@/hooks/use-shippo-bulk-label-flow";
import { getErrorMessage } from "@/lib/api-error";
import { clusterOrdersForCombinedShipping, ordersCanCombineShipping } from "@/lib/shippo-elements";
import {
  isOrderEligibleForToShipQueue,
  type FulfillmentTabKey,
} from "@/lib/store-order-fulfillment";
import {
  BUYER_REFUND_POLICY_CONTINUE_LABEL,
  BUYER_REFUND_POLICY_NEVERMIND_LABEL,
  formatSellerRefundFeeAbsorptionLine,
  SELLER_REFUND_POLICY_POPUP_BODY,
  SELLER_REFUND_POLICY_POPUP_TITLE,
  SELLER_REFUND_POLICY_SHORTFALL_NOTE,
} from "@/lib/store-return";

const SHIPPO_BULK_CONTAINER_ID = "shippo-elements-bulk-storefront-orders";
const SELECTION_STORAGE_KEY = "fulfillment-hub-ship-selection";

function parseTabParam(value: string | null): FulfillmentTabKey {
  if (
    value === "deliveries" ||
    value === "history" ||
    value === "ship" ||
    value === "shipped"
  ) {
    return value;
  }
  return "ship";
}

function fetchWithTimeout(input: string, ms = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(input, { credentials: "include", signal: ctrl.signal }).finally(() => clearTimeout(t));
}

function loadErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof DOMException && e.name === "AbortError") return "Request timed out. Try again.";
  if (e instanceof Error && e.name === "AbortError") return "Request timed out. Try again.";
  return fallback;
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
  const [deliveredOrders, setDeliveredOrders] = useState<FulfillmentStoreOrder[]>([]);
  const [canceledOrders, setCanceledOrders] = useState<FulfillmentStoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [combinedGroups, setCombinedGroups] = useState<string[][]>([]);
  const [sellerProfile, setSellerProfile] = useState<SellerProfileForSlips | null>(null);
  const [shippingConnected, setShippingConnected] = useState<boolean | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelPolicyOrder, setCancelPolicyOrder] = useState<FulfillmentStoreOrder | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [shipActionError, setShipActionError] = useState<string | null>(null);
  const [pendingPrintUrls, setPendingPrintUrls] = useState<string[]>([]);
  const autoBulkStartedRef = useRef(false);
  const runBulkFlowRef = useRef<(ids: string[]) => void>(() => {});

  const toShipOrders = useMemo(
    () => shipOrders.filter(isOrderEligibleForToShipQueue),
    [shipOrders]
  );

  const tabCounts = useMemo(
    () => ({
      ship: toShipOrders.length,
      pickups: 0,
      deliveries: countPendingDeliveryOrders(allOrders),
      shipped: shippedOrders.length,
      canceled: canceledOrders.length,
    }),
    [toShipOrders, allOrders, shippedOrders, canceledOrders]
  );

  const [apiCounts, setApiCounts] = useState<Partial<typeof tabCounts> | null>(null);

  useEffect(() => {
    fetchWithTimeout("/api/store-orders?mine=1&counts=1")
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object" && "toShip" in data) {
          setApiCounts({
            ship: Number((data as { toShip?: number }).toShip) || 0,
            pickups: 0,
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
    fetchWithTimeout("/api/store-orders?mine=1&needsShipment=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return;
        if (Array.isArray(data)) setShipOrders(data as FulfillmentStoreOrder[]);
      })
      .catch(() => {});
  }, []);

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

  const {
    elementsLoading,
    elementsError,
    setElementsError,
    shippoSurfaceOpen,
    closeShippoSurface,
    runBulkFlow,
    progressSubtitle,
    purchasedLabelUrls,
  } = useShippoBulkLabelFlow({
    containerId: SHIPPO_BULK_CONTAINER_ID,
    orders: ordersForBulk,
    onAfterSave: refetchToShipSilent,
    onSessionComplete: ({ labelUrls }) => {
      setPendingPrintUrls(labelUrls);
      setSelectedOrderIds(new Set());
      setTab("shipped");
    },
  });

  runBulkFlowRef.current = runBulkFlow;

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
        fetchWithTimeout("/api/store-orders?mine=1&needsShipment=1")
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
              setFetchError((data as { error?: string }).error ?? "Failed to load orders.");
              setShipOrders([]);
              return;
            }
            setShipOrders(Array.isArray(data) ? data : []);
          })
          .catch((e) => {
            setFetchError(loadErrorMessage(e, "Connection failed."));
            setShipOrders([]);
          })
      );
    }

    if (tab === "deliveries") {
      fetches.push(
        fetchWithTimeout("/api/store-orders?mine=1")
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
              setFetchError((data as { error?: string }).error ?? "Failed to load orders.");
              setAllOrders([]);
              return;
            }
            setAllOrders(Array.isArray(data) ? data : []);
          })
          .catch((e) => {
            setFetchError(loadErrorMessage(e, "Connection failed."));
            setAllOrders([]);
          })
      );
    }

    if (tab === "shipped") {
      fetches.push(
        fetchWithTimeout("/api/store-orders?mine=1&shipped=1")
          .then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
              setFetchError((data as { error?: string }).error ?? "Failed to load shipped orders.");
              setShippedOrders([]);
              return;
            }
            setShippedOrders(Array.isArray(data) ? data : []);
          })
          .catch((e) => {
            setFetchError(loadErrorMessage(e, "Failed to load shipped orders."));
            setShippedOrders([]);
          })
      );
    }

    if (tab === "history") {
      fetches.push(
        Promise.all([
          fetchWithTimeout("/api/store-orders?mine=1&delivered=1").then((r) => r.json()),
          fetchWithTimeout("/api/store-orders?mine=1&canceled=1").then((r) => r.json()),
        ])
          .then(([delivered, canceled]) => {
            setDeliveredOrders(Array.isArray(delivered) ? delivered : []);
            setCanceledOrders(Array.isArray(canceled) ? canceled : []);
          })
          .catch((e) => {
            setFetchError(loadErrorMessage(e, "Failed to load order history."));
            setDeliveredOrders([]);
            setCanceledOrders([]);
          })
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
    fetchWithTimeout("/api/shipping/status")
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json().catch(() => ({}))) as { connected?: boolean };
        if (typeof data.connected === "boolean") setShippingConnected(data.connected);
      })
      .catch(() => {
        // Keep "checking…" rather than treating a timeout as disconnected.
      });
  }, [tab]);

  useEffect(() => {
    if (tab !== "ship") return;
    fetchWithTimeout("/api/seller-profile")
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
  const labelGroups = useMemo(
    () => purchaseGroupsForSelection(selectedIdsArray, combinedGroups),
    [selectedIdsArray, combinedGroups]
  );
  const slipGroups = useMemo(
    () => packingSlipGroupsForSelection(selectedIdsArray, combinedGroups),
    [selectedIdsArray, combinedGroups]
  );
  const canCombineShipping = ordersCanCombineShipping(selectedOrders);
  const eligibleClusters = useMemo(
    () => clusterOrdersForCombinedShipping(toShipOrders).map((group) => group.map((order) => order.id)),
    [toShipOrders]
  );
  const sameIdSet = (left: string[], right: string[]) => {
    if (left.length !== right.length) return false;
    const ids = new Set(left);
    return right.every((id) => ids.has(id));
  };
  const canCombineAll = eligibleClusters.some(
    (cluster) => !combinedGroups.some((group) => sameIdSet(group, cluster))
  );
  const selectionAlreadyGrouped =
    canCombineShipping &&
    combinedGroups.some((group) => sameIdSet(group, selectedOrders.map((order) => order.id)));

  useEffect(() => {
    const live = new Set(toShipOrders.map((order) => order.id));
    setCombinedGroups((prev) =>
      prev
        .map((group) => group.filter((id) => live.has(id)))
        .filter((group) => group.length >= 2)
    );
  }, [toShipOrders]);

  function combineSelectedOrders() {
    if (!ordersCanCombineShipping(selectedOrders)) return;
    const ids = selectedOrders.map((order) => order.id);
    setCombinedGroups((prev) => {
      const without = prev
        .map((group) => group.filter((id) => !ids.includes(id)))
        .filter((group) => group.length >= 2);
      return [...without, ids];
    });
  }

  function combineAllEligible() {
    setCombinedGroups(eligibleClusters);
  }

  function separateGroup(ids: string[]) {
    setCombinedGroups((prev) => prev.filter((group) => !sameIdSet(group, ids)));
  }

  function toggleGroupSelection(ids: string[]) {
    setSelectedOrderIds((prev) => {
      const allOn = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  const shipRows = useMemo(() => {
    const memberOf = new Map<string, string[]>();
    for (const group of combinedGroups) {
      if (group.length < 2) continue;
      for (const id of group) memberOf.set(id, group);
    }
    const seen = new Set<string>();
    const rows: Array<
      | { type: "single"; order: FulfillmentStoreOrder }
      | { type: "group"; orders: FulfillmentStoreOrder[]; ids: string[] }
    > = [];
    for (const order of toShipOrders) {
      if (seen.has(order.id)) continue;
      const group = memberOf.get(order.id);
      if (group) {
        const members = group
          .map((id) => toShipOrders.find((candidate) => candidate.id === id))
          .filter((candidate): candidate is FulfillmentStoreOrder => Boolean(candidate));
        if (members.length >= 2) {
          members.forEach((member) => seen.add(member.id));
          rows.push({ type: "group", orders: members, ids: members.map((member) => member.id) });
          continue;
        }
      }
      seen.add(order.id);
      rows.push({ type: "single", order });
    }
    return rows;
  }, [combinedGroups, toShipOrders]);

  const printSlips = () => {
    window.print();
  };

  function requestCancelAndRefund(order: FulfillmentStoreOrder) {
    setMenuOpenId(null);
    setCancelPolicyOrder(order);
  }

  async function confirmCancelAndRefund(order: FulfillmentStoreOrder) {
    setCancelPolicyOrder(null);
    setCancelingId(order.id);
    setShipActionError(null);
    try {
      const res = await fetch(`/api/store-orders/${order.id}/seller-cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setShipActionError(getErrorMessage(data.error, "Could not cancel this order."));
        return;
      }
      setShipOrders((prev) => prev.filter((o) => o.id !== order.id));
      setSelectedOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    } finally {
      setCancelingId(null);
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
        <p className="text-sm text-gray-600 mb-4">Manage shipping and local delivery in one place.</p>
        <EtsyPersonalizationNotes />

        <FulfillmentTabBar activeTab={tab} onTabChange={setTab} counts={displayCounts} />

        {tab === "shipped" && pendingPrintUrls.length > 0 ? (
          <div className="mb-4 p-3 rounded-lg border border-green-200 bg-green-50 text-green-900 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium">Label purchased. Print it now if a PDF window didn’t open.</p>
              <button
                type="button"
                className="text-green-800 underline shrink-0"
                onClick={() => setPendingPrintUrls([])}
              >
                Dismiss
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <ShippoPrintLabelActions urls={pendingPrintUrls} />
            </div>
          </div>
        ) : null}

        {elementsError ? (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
            {elementsError}
          </div>
        ) : null}

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
            {shipActionError ? (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                {shipActionError}
              </div>
            ) : null}

            <ShippoConnectionBanner
              connected={shippingConnected}
              shippingSetupHref={props.shippingSetupHref}
              orderCount={toShipOrders.length}
            />

            {canCombineAll ? (
              <div className="mb-4">
                <button type="button" className="btn-outline" onClick={combineAllEligible}>
                  Combine eligible orders
                </button>
              </div>
            ) : null}

            {toShipOrders.length === 0 ? (
              <OrderEmptyState tab="ship" />
            ) : (
              <ul className="space-y-3 mb-8">
                {shipRows.map((row) =>
                  row.type === "group" ? (
                    <li key={row.ids.join("-")}>
                      <CombinedOrderCard
                        orders={row.orders}
                        ordersBasePath={props.ordersBasePath}
                        selected={row.ids.every((id) => selectedOrderIds.has(id))}
                        onToggle={() => toggleGroupSelection(row.ids)}
                        onSeparate={() => separateGroup(row.ids)}
                      />
                    </li>
                  ) : (
                  <li key={row.order.id}>
                    <OrderCard
                      order={row.order}
                      ordersBasePath={props.ordersBasePath}
                      selectable={shippingConnected === true}
                      selected={selectedOrderIds.has(row.order.id)}
                      onToggleSelect={toggleOrderSelection}
                      menu={
                        <div className="relative">
                          <button
                            type="button"
                            className="w-9 h-9 rounded border border-gray-300 text-lg leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            aria-label="Order options"
                            disabled={cancelingId === row.order.id}
                            onClick={() => setMenuOpenId((id) => (id === row.order.id ? null : row.order.id))}
                          >
                            ⋮
                          </button>
                          {menuOpenId === row.order.id ? (
                            <>
                              <button
                                type="button"
                                className="fixed inset-0 z-40 cursor-default"
                                aria-label="Close menu"
                                onClick={() => setMenuOpenId(null)}
                              />
                              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-52 text-sm">
                                <Link
                                  href={`${props.ordersBasePath}/${row.order.id}`}
                                  className="block px-3 py-2 hover:bg-gray-50"
                                  style={{ color: "var(--color-link)" }}
                                  onClick={() => setMenuOpenId(null)}
                                >
                                  View Order
                                </Link>
                                <button
                                  type="button"
                                  className="block w-full text-left px-3 py-2 hover:bg-red-50 text-red-700 font-medium disabled:opacity-50"
                                  disabled={cancelingId === row.order.id}
                                  onClick={() => requestCancelAndRefund(row.order)}
                                >
                                  {cancelingId === row.order.id
                                    ? "Canceling…"
                                    : row.order.stripePaymentIntentId
                                      ? "Cancel & refund"
                                      : "Cancel order"}
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      }
                    />
                  </li>
                  )
                )}
              </ul>
            )}

            {selectedOrders.length > 0 && sellerProfile ? (
              <div className="sr-only print:not-sr-only fixed -left-[9999px] print:static print:left-auto">
                <PackingSlipPrint
                  orders={selectedOrders.map((o) => ({
                    ...o,
                    shippingCostCents: o.shippingCostCents ?? 0,
                    shippingAddress: o.shippingAddress ?? {},
                    taxCents: o.taxCents,
                    items: (o.items ?? []).map((item) => ({
                      ...item,
                      priceCentsAtPurchase: item.priceCentsAtPurchase ?? 0,
                    })),
                  }))}
                  sellerProfile={sellerProfile}
                  slipGroups={slipGroups}
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
              onPurchaseLabels={() =>
                void runBulkFlow(selectedIdsArray, {
                  groups: labelGroups,
                })
              }
              onCombineShipping={
                canCombineShipping && !selectionAlreadyGrouped ? combineSelectedOrders : undefined
              }
              onPrintSlips={printSlips}
              onSelectAll={selectAllToShip}
              onClearSelection={clearSelection}
              slipsDisabled={!sellerProfile}
            />
          </>
        ) : tab === "deliveries" ? (
          <DeliveryQueueSection
            orders={allOrders}
            ordersBasePath={props.ordersBasePath}
            onOrderUpdated={(updated) =>
              setAllOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)))
            }
            onOrderRemoved={(orderId) => setAllOrders((prev) => prev.filter((o) => o.id !== orderId))}
          />
        ) : tab === "shipped" ? (
          <ShippedOrderSection
            shippedOrders={shippedOrders}
            ordersBasePath={props.ordersBasePath}
          />
        ) : (
          <HistoryOrderSection
            deliveredOrders={deliveredOrders}
            canceledOrders={canceledOrders}
            ordersBasePath={props.ordersBasePath}
          />
        )}
      </div>

      <ShippoElementsSurface
        open={shippoSurfaceOpen}
        onClose={closeShippoSurface}
        containerId={SHIPPO_BULK_CONTAINER_ID}
        title="Shippo — Labels"
        presentation="page"
        subtitle={progressSubtitle}
        actions={<ShippoPrintLabelActions urls={purchasedLabelUrls} />}
      />

      {cancelPolicyOrder ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close"
            onClick={() => setCancelPolicyOrder(null)}
            disabled={cancelingId != null}
          />
          <div
            className="relative w-full max-w-md rounded-lg border-2 p-6 max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)" }}
            role="dialog"
            aria-modal
            aria-labelledby="seller-refund-policy-title"
          >
            <h3
              id="seller-refund-policy-title"
              className="text-lg font-bold mb-3"
              style={{ color: "var(--color-heading)" }}
            >
              {SELLER_REFUND_POLICY_POPUP_TITLE}
            </h3>
            <p className="text-sm mb-4 leading-relaxed opacity-90 whitespace-pre-line">
              {SELLER_REFUND_POLICY_POPUP_BODY}
            </p>
            <p className="text-sm font-semibold mb-2" style={{ color: "var(--color-primary)" }}>
              {formatSellerRefundFeeAbsorptionLine({
                totalCents: cancelPolicyOrder.totalCents,
                taxCents: cancelPolicyOrder.taxCents,
              })}
            </p>
            <p className="text-xs mb-2 opacity-80">{SELLER_REFUND_POLICY_SHORTFALL_NOTE}</p>
            <p className="text-xs mb-6 opacity-70">
              Listing quantities will be restored. This cannot be undone.
            </p>
            <div className="flex flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={() => void confirmCancelAndRefund(cancelPolicyOrder)}
                className="btn text-white hover:text-white"
                style={{ backgroundColor: "var(--color-primary)" }}
                disabled={cancelingId != null}
              >
                {cancelingId === cancelPolicyOrder.id
                  ? "Canceling…"
                  : BUYER_REFUND_POLICY_CONTINUE_LABEL}
              </button>
              <button
                type="button"
                onClick={() => setCancelPolicyOrder(null)}
                className="px-4 py-2 rounded border-2"
                style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                disabled={cancelingId != null}
              >
                {BUYER_REFUND_POLICY_NEVERMIND_LABEL}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
