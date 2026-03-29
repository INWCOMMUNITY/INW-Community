"use client";

import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import Script from "next/script";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { ShippoElementsModal } from "@/components/ShippoElementsModal";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";
import {
  buildOrderDetailsFromOrder,
  transactionToLabelFromElementsPayload,
  type ElementsTransactionPayload,
} from "@/lib/shippo-elements";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";
import { notifyNwAppShippoLabelSuccess } from "@/lib/nw-app-webview-bridge";
import {
  NWC_SHIPPO_ELEMENTS_THEME,
  type ShippoElementsTheme,
} from "@/lib/shippo-elements-theme";

const SHIPPO_ORG = "inw-community";
const SHIPPO_CONTAINER_ID = "shippo-elements-container";

interface ShippoElementsAPI {
  init: (opts: { token: string; org: string; theme?: ShippoElementsTheme }) => void;
  labelPurchase: (selector: string, orderDetails: unknown) => void;
  on: (event: string, callback: (arg: unknown) => void) => void;
}
const SHIPPO_EMBEDDABLE_URL = "https://js.goshippo.com/embeddable-client.js";

function isShippoReady(shippo: ShippoElementsAPI | undefined): shippo is ShippoElementsAPI {
  return (
    shippo != null &&
    typeof shippo.init === "function" &&
    typeof shippo.labelPurchase === "function"
  );
}

/** Wait for Shippo embeddable script to be available (poll up to 8s). */
function waitForShippo(): Promise<ShippoElementsAPI | null> {
  return new Promise((resolve) => {
    const win = typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }) : null;
    if (win?.shippo != null && isShippoReady(win.shippo)) {
      resolve(win.shippo);
      return;
    }
    let attempts = 0;
    const maxAttempts = 120; // 12s at 100ms (CDN / first paint)
    const interval = setInterval(() => {
      const w = typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }) : null;
      if (w?.shippo != null && isShippoReady(w.shippo)) {
        clearInterval(interval);
        resolve(w.shippo);
        return;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
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

const DEFAULT_WEIGHT_OZ = 16;
const DEFAULT_LENGTH_IN = 12;
const DEFAULT_WIDTH_IN = 12;
const DEFAULT_HEIGHT_IN = 12;

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
  const [elementsLoading, setElementsLoading] = useState(false);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const [shippoModalOpen, setShippoModalOpen] = useState(false);
  const [shippingConnected, setShippingConnected] = useState<boolean | null>(null);
  const [shippedMenuOpenId, setShippedMenuOpenId] = useState<string | null>(null);
  const elementsListenersRef = useRef(false);
  const currentElementsOrderIdsRef = useRef<string[]>([]);
  const shippoOrderIdsRef = useRef<string[]>([]);

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
    if (tab !== "to_ship") {
      setShippingConnected(null);
      return;
    }
    if (orders.length === 0) return;
    const toShip = orders.filter(
      (o) => o.status === "paid" && !o.shipment && !(o as { shippedWithOrderId?: string }).shippedWithOrderId
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
      (o) => o.status === "paid" && !o.shipment && !(o as { shippedWithOrderId?: string }).shippedWithOrderId
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
    const toShip = orders.filter((o) => o.status === "paid" && !o.shipment && !(o as { shippedWithOrderId?: string }).shippedWithOrderId);
    setSelectedOrderIds(new Set(toShip.map((o) => o.id)));
  }

  async function runShippoLabelFlow(orderIds: string[], forReprint: boolean) {
    if (orderIds.length === 0) {
      setElementsError("Select at least one order.");
      return;
    }
    const selectedOrders = orders.filter((o) => orderIds.includes(o.id));
    let orderDetails: unknown;
    if (forReprint && orderIds.length === 1) {
      const o = selectedOrders[0];
      const oid = o?.shipment?.shippoOrderId?.trim();
      if (!oid) {
        setElementsError("No Shippo order on file to reprint.");
        return;
      }
      const one = buildOrderDetailsFromOrder(o, oid);
      if (!one) {
        setElementsError("Order has no valid shipping address.");
        return;
      }
      orderDetails = one;
    } else {
      const orderDetailsArray: ReturnType<typeof buildOrderDetailsFromOrder>[] = [];
      for (const o of selectedOrders) {
        const one = buildOrderDetailsFromOrder(o, undefined, {
          freshShippoOrder: Boolean(o.shipment) && !forReprint,
        });
        if (!one) {
          setElementsError("Selected order(s) have no valid shipping address.");
          return;
        }
        orderDetailsArray.push(one);
      }
      orderDetails = orderDetailsArray.length === 1 ? orderDetailsArray[0] : orderDetailsArray;
    }
    setElementsError(null);
    setElementsLoading(true);
    try {
      const tokenRes = await fetch("/api/shipping/elements-token");
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        const code = (tokenData as { code?: string }).code;
        if (code === "SHIPPING_ACCOUNT_REQUIRED") {
          setElementsError("Connect your shipping account in shipping setup first.");
          return;
        }
        setElementsError((tokenData as { error?: string }).error ?? "Could not load Shippo widget.");
        return;
      }
      const token = (tokenData as { token?: string }).token;
      if (!token) {
        setElementsError("Could not get widget token.");
        return;
      }
      let shippo = typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }).shippo : null;
      if (!shippo?.init || !shippo?.labelPurchase) {
        shippo = await waitForShippo();
        if (!shippo?.init || !shippo?.labelPurchase) {
          setElementsError(
            "Shippo could not load (the script may be blocked). Try a hard refresh, pause ad blockers for this site, or try another browser. If it persists, contact support."
          );
          return;
        }
      }
      shippo.init({ token, org: SHIPPO_ORG, theme: NWC_SHIPPO_ELEMENTS_THEME });
      currentElementsOrderIdsRef.current = orderIds;
      shippoOrderIdsRef.current = [];
      if (!elementsListenersRef.current) {
        elementsListenersRef.current = true;
        shippo.on("ORDER_CREATED", (params: unknown) => {
          const p = params as { order_id?: string };
          if (p?.order_id) shippoOrderIdsRef.current.push(p.order_id);
        });
        shippo.on("LABEL_PURCHASED_SUCCESS", async (transactions: unknown) => {
          const txs = Array.isArray(transactions) ? (transactions as ElementsTransactionPayload[]) : [];
          const labeledOrderIds = currentElementsOrderIdsRef.current;
          if (labeledOrderIds.length === 0 || txs.length === 0) return;
          const firstTx = txs[0] as ElementsTransactionPayload;
          const payload = transactionToLabelFromElementsPayload(firstTx, {
            weightOz: DEFAULT_WEIGHT_OZ,
            lengthIn: DEFAULT_LENGTH_IN,
            widthIn: DEFAULT_WIDTH_IN,
            heightIn: DEFAULT_HEIGHT_IN,
          });
          const shippoOrderId =
            firstTx.order_id?.trim() || shippoOrderIdsRef.current[0]?.trim() || null;
          try {
            const res = await fetch("/api/shipping/label-from-elements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderIds: labeledOrderIds,
                ...payload,
                ...(shippoOrderId ? { shippoOrderId } : {}),
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              setSelectedOrderIds(new Set());
              setOrders((prev) =>
                prev.map((o) => {
                  if (!labeledOrderIds.includes(o.id)) return o;
                  const ship = (data as { shipment?: { id: string; trackingNumber?: string; carrier?: string; service?: string } }).shipment;
                  return {
                    ...o,
                    status: "shipped",
                    shipment: ship
                      ? {
                          id: ship.id,
                          carrier: ship.carrier ?? "",
                          service: ship.service ?? "",
                          trackingNumber: ship.trackingNumber ?? null,
                          labelUrl: null,
                        }
                      : undefined,
                  };
                })
              );
              notifyNwAppShippoLabelSuccess({ orderIds: labeledOrderIds });
            } else {
              setElementsError(
                typeof (data as { error?: string }).error === "string"
                  ? (data as { error: string }).error
                  : "Could not save label to your order. If you were charged, contact support with your order number."
              );
            }
          } catch {
            setElementsError("Could not save label to your order.");
          }
        });
        shippo.on("ERROR", (err: unknown) => {
          const msg = err && typeof err === "object" && "detail" in err ? String((err as { detail: string }).detail) : "Something went wrong.";
          setElementsError(msg);
        });
      }
      const mount = document.getElementById(SHIPPO_CONTAINER_ID);
      if (mount) mount.innerHTML = "";
      flushSync(() => {
        setShippoModalOpen(true);
      });
      shippo.labelPurchase(`#${SHIPPO_CONTAINER_ID}`, orderDetails);
    } catch {
      setElementsError("Connection failed.");
    } finally {
      setElementsLoading(false);
    }
  }

  const runShippoLabelFlowRef = useRef(runShippoLabelFlow);
  runShippoLabelFlowRef.current = runShippoLabelFlow;
  const autoNwAppBulkRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || loading) return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("nwAppShippo") !== "bulk" || autoNwAppBulkRef.current) return;
    if (tab !== "to_ship") {
      setTab("to_ship");
      return;
    }
    const toShip = orders.filter(
      (o) =>
        o.status === "paid" &&
        !o.shipment &&
        !(o as { shippedWithOrderId?: string }).shippedWithOrderId
    );
    autoNwAppBulkRef.current = true;
    sp.delete("nwAppShippo");
    sp.delete("nwAppChrome");
    const qs = sp.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
    );
    if (toShip.length === 0) {
      setElementsError("No orders to ship.");
      return;
    }
    void runShippoLabelFlowRef.current(
      toShip.map((o) => o.id),
      false
    );
  }, [loading, tab, orders]);

  async function openElementsFlow() {
    await runShippoLabelFlow(Array.from(selectedOrderIds), false);
  }

  function closeShippoModal() {
    setShippoModalOpen(false);
  }

  const toShipOrders = orders.filter(
    (o) => o.status === "paid" && !o.shipment && !(o as { shippedWithOrderId?: string }).shippedWithOrderId
  );
  const selectedOrders = orders.filter((o) => selectedOrderIds.has(o.id));
  const sameBuyer =
    selectedOrders.length <= 1 ||
    selectedOrders.every((o) => o.buyer.email === selectedOrders[0].buyer.email);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <Script src={SHIPPO_EMBEDDABLE_URL} strategy="afterInteractive" />
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
            {elementsError && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                {elementsError}
                {elementsError.includes("Connect your shipping") && (
                  <Link href={props.shippingSetupHref} className="ml-2 underline">
                    Go to shipping setup
                  </Link>
                )}
              </div>
            )}

            <ShippoElementsModal
              open={shippoModalOpen}
              onClose={closeShippoModal}
              containerId={SHIPPO_CONTAINER_ID}
              title="Purchase shipping label"
            />

            {tab === "to_ship" ? (
          <>
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
                <p className="text-sm text-gray-600 mb-4">You have {toShipOrders.length} order{toShipOrders.length !== 1 ? "s" : ""} to ship. After connecting, select orders and click <strong>Purchase labels</strong>.</p>
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
                  Select orders, then click <strong>Purchase labels</strong>. The label tool opens in a large popup—choose carrier, pay, and print.{" "}
                  <Link href={props.shippingSetupHref} className="underline" style={{ color: "var(--color-link)" }}>
                    Connect shipping
                  </Link>{" "}
                  if you haven’t yet.
                </p>

                <div className="mb-6 flex flex-wrap gap-4 items-center">
                  <button
                    type="button"
                    onClick={openElementsFlow}
                    disabled={elementsLoading || selectedOrderIds.size === 0}
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
                                      <button
                                        type="button"
                                        className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-[var(--color-primary)]"
                                        onClick={() => {
                                          setShippedMenuOpenId(null);
                                          void runShippoLabelFlow([order.id], true);
                                        }}
                                      >
                                        Reprint label
                                      </button>
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
                                    <button
                                      type="button"
                                      className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-[var(--color-primary)]"
                                      onClick={() => {
                                        setShippedMenuOpenId(null);
                                        void runShippoLabelFlow([order.id], false);
                                      }}
                                    >
                                      Purchase another label
                                    </button>
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
    </section>
  );
}
