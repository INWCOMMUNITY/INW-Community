"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { ShippoElementsSurface } from "@/components/ShippoElementsModal";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";
import {
  useShippoBulkLabelFlow,
  SHIPPO_BULK_EMBEDDABLE_URL,
  isOrderEligibleForBulkShip,
  type StoreOrderForBulkLabel,
} from "@/hooks/use-shippo-bulk-label-flow";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";

const SHIPPO_BULK_CONTAINER_ID = "shippo-elements-bulk-storefront-orders";

function shippoLabelPageHref(orderId: string, labelAction: "reprint" | "another") {
  const q = new URLSearchParams({ labelAction });
  return `/seller-hub/orders/shippo/${orderId}?${q.toString()}`;
}

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  fulfillmentType?: string | null;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface Shipment {
  id: string;
  carrier: string;
  service: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  shippoOrderId?: string | null;
  createdAt?: string;
}

interface StoreOrder {
  id: string;
  orderNumber?: string;
  orderKind?: string;
  totalCents: number;
  shippingCostCents: number;
  status: string;
  stripePaymentIntentId?: string | null;
  shippingAddress: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  shipment?: Shipment | null;
}

function sellerOrderTotalDisplay(order: Pick<StoreOrder, "orderKind" | "totalCents">): string {
  if (order.orderKind === "reward_redemption" && order.totalCents === 0) {
    return "No charge to member (reward)";
  }
  return `$${(order.totalCents / 100).toFixed(2)}`;
}

interface SellerProfile {
  business: {
    name: string;
    phone: string | null;
    address: string | null;
    city?: string | null;
    logoUrl: string | null;
    website?: string | null;
    email?: string | null;
  } | null;
  returnAddressFormatted?: string | null;
  packingSlipNote?: string | null;
}

const ORDER_TABS = [
  { key: "to_ship", label: "To Ship", param: "mine=1&needsShipment=1" },
  { key: "shipped", label: "Shipped", param: "mine=1&shipped=1" },
  { key: "canceled", label: "Canceled", param: "mine=1&canceled=1" },
] as const;

type TabKey = (typeof ORDER_TABS)[number]["key"];

function getTrackingUrl(carrier: string, trackingNumber: string): string {
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  return `https://www.google.com/search?q=track+${trackingNumber}`;
}

export function StorefrontOrdersContent(props: {
  backHref: string;
  backLabel: string;
  title: string;
  ordersBasePath: string;
  shippingSetupHref: string;
  loginCallbackUrl: string;
}) {
  const [tab, setTab] = useState<TabKey>("to_ship");
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [shippingConnected, setShippingConnected] = useState<boolean | null>(null);
  const [shippedMenuOpenId, setShippedMenuOpenId] = useState<string | null>(null);
  const autoBulkStartedRef = useRef(false);
  const runBulkFlowRef = useRef<(ids: string[]) => void>(() => {});

  const ordersForBulk = useMemo(
    (): StoreOrderForBulkLabel[] => (tab === "to_ship" ? (orders as StoreOrderForBulkLabel[]) : []),
    [tab, orders]
  );

  const refetchToShipSilent = useCallback(() => {
    if (tab !== "to_ship") return;
    fetch("/api/store-orders?mine=1&needsShipment=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return;
        if (Array.isArray(data)) setOrders(data as StoreOrder[]);
      })
      .catch(() => {});
  }, [tab]);

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

  /** Deep link (e.g. mobile WebView): open To Ship and auto-start bulk Shippo on this page. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("nwAppShippo") !== "bulk" && sp.get("autoBulk") !== "1") return;
    setTab("to_ship");
  }, []);

  useEffect(() => {
    setFetchError(null);
    setLoading(true);
    const param = ORDER_TABS.find((t) => t.key === tab)?.param ?? "mine=1";
    fetch(`/api/store-orders?${param}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = (data as { error?: string }).error ?? "Failed to load orders.";
          setFetchError(err);
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then(setOrders)
      .catch(() => {
        setFetchError("Connection failed.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab !== "to_ship" || loading) return;
    const sp = new URLSearchParams(window.location.search);
    const bulk = sp.get("nwAppShippo") === "bulk" || sp.get("autoBulk") === "1";
    if (!bulk || autoBulkStartedRef.current) return;
    autoBulkStartedRef.current = true;
    sp.delete("nwAppShippo");
    sp.delete("autoBulk");
    sp.delete("nwAppChrome");
    const qs = sp.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
    );
    const eligibleIds = orders.filter(isOrderEligibleForBulkShip).map((o) => o.id);
    if (eligibleIds.length === 0) {
      setElementsError("No orders to ship.");
      return;
    }
    void runBulkFlowRef.current(eligibleIds);
  }, [tab, loading, orders, setElementsError]);

  useEffect(() => {
    if (tab !== "to_ship") {
      setShippingConnected(null);
      return;
    }
    if (orders.length === 0) return;
    const toShip = orders.filter(
      (o) =>
        o.status === "paid" &&
        !o.shipment &&
        !(o as { shippedWithOrderId?: string }).shippedWithOrderId &&
        orderHasShippedLine(o.items)
    );
    if (toShip.length === 0) return;
    fetch("/api/shipping/status")
      .then((r) => r.json().catch(() => ({})))
      .then((data: { connected?: boolean }) => setShippingConnected(!!data.connected))
      .catch(() => setShippingConnected(false));
  }, [tab, orders]);

  useEffect(() => {
    if (tab !== "to_ship" || orders.length === 0) return;
    const toShip = orders.filter(
      (o) =>
        o.status === "paid" &&
        !o.shipment &&
        !(o as { shippedWithOrderId?: string }).shippedWithOrderId &&
        orderHasShippedLine(o.items)
    );
    if (toShip.length > 0) setSelectedOrderIds(new Set(toShip.map((o) => o.id)));
  }, [tab, orders]);

  useEffect(() => {
    if (tab !== "to_ship") return;
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

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function selectAllToShip() {
    const toShip = orders.filter(
      (o) =>
        o.status === "paid" &&
        !o.shipment &&
        !(o as { shippedWithOrderId?: string }).shippedWithOrderId &&
        orderHasShippedLine(o.items)
    );
    setSelectedOrderIds(new Set(toShip.map((o) => o.id)));
  }

  const toShipOrders = orders.filter(
    (o) =>
      o.status === "paid" &&
      !o.shipment &&
      !(o as { shippedWithOrderId?: string }).shippedWithOrderId &&
      orderHasShippedLine(o.items)
  );
  const selectedIdsArray = useMemo(() => Array.from(selectedOrderIds), [selectedOrderIds]);
  const selectedOrders = orders.filter((o) => selectedOrderIds.has(o.id));
  const sameBuyer =
    selectedOrders.length <= 1 ||
    selectedOrders.every((o) => o.buyer.email === selectedOrders[0].buyer.email);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <Script src={SHIPPO_BULK_EMBEDDABLE_URL} strategy="afterInteractive" />
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href={props.backHref} className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          {props.backLabel}
        </Link>
        <h1 className="text-2xl font-bold mb-4">{props.title}</h1>

        {fetchError && (
          <div className="border rounded-lg p-6 bg-red-50 mb-6">
            <p className="text-red-700">{fetchError}</p>
            {fetchError.toLowerCase().includes("sign in") && (
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(props.loginCallbackUrl)}`}
                className="btn mt-4 inline-block"
              >
                Sign in
              </Link>
            )}
          </div>
        )}

        <div className="flex gap-2 mb-6 border-b border-gray-200">
          {ORDER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.key
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : (
          <>
            {tab === "to_ship" ? (
          <>
            {tab === "to_ship" && elementsError && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                {elementsError}
              </div>
            )}

            {toShipOrders.length === 0 ? (
              <p className="text-gray-500">No orders to ship.</p>
            ) : shippingConnected === false ? (
              <>
                <div className="border-2 rounded-lg p-6 mb-6 border-amber-200 bg-amber-50">
                  <p className="font-medium text-amber-900 mb-2">Connect your Shippo account to purchase and print labels.</p>
                  <Link href={props.shippingSetupHref} className="btn inline-block">
                    Connect shipping
                  </Link>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  You have {toShipOrders.length} order{toShipOrders.length !== 1 ? "s" : ""} to ship. After connecting, use{" "}
                  <strong>Purchase labels</strong> on this page to buy postage in the full-page Shippo tool.
                </p>
                <ul className="space-y-4">
                  {toShipOrders.map((order) => (
                    <li key={order.id} className="border rounded-lg p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div>
                            <span className="font-medium">
                              Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}
                              {order.orderKind === "reward_redemption" ? (
                                <span className="ml-2 text-xs font-semibold uppercase text-amber-800">
                                  Reward redemption
                                </span>
                              ) : null}
                            </span>
                            <p className="text-sm text-gray-600">
                              {order.buyer.firstName} {order.buyer.lastName} — {new Date(order.createdAt).toLocaleString()}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              {formatShippingAddress(order.shippingAddress) || "—"}
                            </p>
                            <p className="font-semibold mt-1">{sellerOrderTotalDisplay(order)}</p>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  Select orders below, then <strong>Purchase labels</strong>. The Shippo tool opens full screen—choose
                  carrier, pay, and print. Orders from the same buyer are combined into one purchase; multiple buyers mean
                  one Shippo checkout per buyer.{" "}
                  <Link href={props.shippingSetupHref} className="underline" style={{ color: "var(--color-link)" }}>
                    Shipping setup
                  </Link>{" "}
                  if you have not connected Shippo yet.
                </p>

                <div className="mb-6 flex flex-wrap gap-4 items-center">
                  <button
                    type="button"
                    onClick={() => void runBulkFlow(selectedIdsArray)}
                    disabled={elementsLoading || shippoSurfaceOpen || selectedOrderIds.size === 0}
                    className="btn text-sm py-2 px-4 disabled:opacity-50"
                  >
                    {elementsLoading ? "Opening…" : "Purchase labels"}
                  </button>
                  <button
                    type="button"
                    onClick={selectAllToShip}
                    className="text-sm font-medium text-gray-700 hover:underline"
                  >
                    Select all to ship
                  </button>
                </div>

                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-800 mb-2">Packing slips</p>
                  <p className="text-sm text-gray-600 mb-2">
                    Use the same selection to print packing slips (optional).
                  </p>
                </div>

                {selectedOrders.length > 0 && sellerProfile && (
                  <div className="mb-6">
                    <PackingSlipPrint
                      orders={selectedOrders}
                      sellerProfile={sellerProfile}
                      combined={selectedOrders.length > 1 && sameBuyer}
                    />
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="btn text-sm py-2 px-4 no-print"
                    >
                      Print packing slip
                    </button>
                  </div>
                )}

                <ul className="space-y-4">
                  {toShipOrders.map((order) => (
                    <li key={order.id} className="border rounded-lg p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.has(order.id)}
                            onChange={() => toggleOrderSelection(order.id)}
                            className="mt-1"
                          />
                          <div>
                            <Link
                              href={props.ordersBasePath + "/" + order.id}
                              className="font-medium hover:underline inline-flex flex-wrap items-center gap-x-2 gap-y-0"
                              style={{ color: "var(--color-link)" }}
                            >
                              <span>Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}</span>
                              {order.orderKind === "reward_redemption" ? (
                                <span className="text-xs font-semibold uppercase text-amber-800">Reward redemption</span>
                              ) : null}
                            </Link>
                            <p className="text-sm text-gray-600">
                              {order.buyer.firstName} {order.buyer.lastName} — {new Date(order.createdAt).toLocaleString()}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              {formatShippingAddress(order.shippingAddress) || "—"}
                            </p>
                            <p className="font-semibold mt-1">{sellerOrderTotalDisplay(order)}</p>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <>
            {orders.length === 0 ? (
              <p className="text-gray-500">
                {tab === "shipped" ? "No shipped orders." : "No canceled orders."}
              </p>
            ) : (
              <ul className="space-y-4">
                {orders.map((order) => {
                  const canReprint =
                    tab === "shipped" &&
                    order.shipment &&
                    isWithinLabelReprintWindow(order.shipment.createdAt);
                  return (
                    <li key={order.id} className="border rounded-lg p-4 relative">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={props.ordersBasePath + "/" + order.id}
                            className="font-medium hover:underline inline-flex flex-wrap items-center gap-x-2 gap-y-0"
                            style={{ color: "var(--color-link)" }}
                          >
                            <span>Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}</span>
                            {order.orderKind === "reward_redemption" ? (
                              <span className="text-xs font-semibold uppercase text-amber-800">Reward redemption</span>
                            ) : null}
                          </Link>
                          <p className="text-sm text-gray-600">
                            {order.buyer.firstName} {order.buyer.lastName} — {new Date(order.createdAt).toLocaleString()}
                          </p>
                          <span
                            className="inline-block mt-1 px-2 py-0.5 rounded text-sm"
                            style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                          >
                            {getOrderStatusLabel(order.status)}
                          </span>
                          {order.shipment?.trackingNumber && (
                            <p className="text-sm mt-1">
                              <a
                                href={getTrackingUrl(order.shipment.carrier, order.shipment.trackingNumber)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                                style={{ color: "var(--color-link)" }}
                              >
                                {order.shipment.carrier} {order.shipment.trackingNumber}
                              </a>
                            </p>
                          )}
                        </div>
                        <div className="flex items-start gap-3 shrink-0">
                          <p className="font-semibold">{sellerOrderTotalDisplay(order)}</p>
                          {tab === "shipped" && order.shipment ? (
                            <div className="relative">
                              <button
                                type="button"
                                className="w-9 h-9 rounded border border-gray-300 text-lg leading-none text-gray-700 hover:bg-gray-50"
                                aria-label="Order actions"
                                onClick={() =>
                                  setShippedMenuOpenId((id) => (id === order.id ? null : order.id))
                                }
                              >
                                ⋮
                              </button>
                              {shippedMenuOpenId === order.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="fixed inset-0 z-40 cursor-default"
                                    aria-label="Close menu"
                                    onClick={() => setShippedMenuOpenId(null)}
                                  />
                                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-52 text-sm">
                                    <Link
                                      href={props.ordersBasePath + "/" + order.id}
                                      className="block px-3 py-2 hover:bg-gray-50"
                                      style={{ color: "var(--color-link)" }}
                                      onClick={() => setShippedMenuOpenId(null)}
                                    >
                                      View order
                                    </Link>
                                    {canReprint && order.shipment.shippoOrderId ? (
                                      <Link
                                        href={shippoLabelPageHref(order.id, "reprint")}
                                        className="block px-3 py-2 hover:bg-gray-50 text-[var(--color-primary)]"
                                        onClick={() => setShippedMenuOpenId(null)}
                                      >
                                        Reprint label
                                      </Link>
                                    ) : null}
                                    {canReprint && order.shipment.labelUrl ? (
                                      <a
                                        href={order.shipment.labelUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block px-3 py-2 hover:bg-gray-50"
                                        style={{ color: "var(--color-link)" }}
                                        onClick={() => setShippedMenuOpenId(null)}
                                      >
                                        Open label PDF
                                      </a>
                                    ) : null}
                                    <Link
                                      href={shippoLabelPageHref(order.id, "another")}
                                      className="block px-3 py-2 hover:bg-gray-50 text-[var(--color-primary)]"
                                      onClick={() => setShippedMenuOpenId(null)}
                                    >
                                      Purchase another label
                                    </Link>
                                  </div>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
          </>
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
