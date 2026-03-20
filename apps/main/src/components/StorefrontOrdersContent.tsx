"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";
import {
  buildOrderDetailsFromOrders,
  transactionToLabelFromElementsPayload,
  type ElementsTransactionPayload,
} from "@/lib/shippo-elements";
import {
  NWC_SHIPPO_ELEMENTS_THEME,
  type ShippoElementsTheme,
} from "@/lib/shippo-elements-theme";

const SHIPPO_ORG = "inw-community";

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
    const maxAttempts = 80; // 8s at 100ms
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
}

interface StoreOrder {
  id: string;
  orderNumber?: string;
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
  { key: "to_ship", label: "To ship", param: "mine=1&needsShipment=1" },
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
  const [shippingConnected, setShippingConnected] = useState<boolean | null>(null);
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

  async function openElementsFlow() {
    const ids = Array.from(selectedOrderIds);
    if (ids.length === 0) {
      setElementsError("Select at least one order.");
      return;
    }
    const selectedOrders = orders.filter((o) => ids.includes(o.id));
    const orderDetailsArray = buildOrderDetailsFromOrders(selectedOrders);
    if (!orderDetailsArray?.length) {
      setElementsError("Selected order(s) have no valid shipping address.");
      return;
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
          setElementsError("Shippo widget is still loading. Try again in a moment.");
          return;
        }
      }
      shippo.init({ token, org: SHIPPO_ORG, theme: NWC_SHIPPO_ELEMENTS_THEME });
      currentElementsOrderIdsRef.current = ids;
      shippoOrderIdsRef.current = [];
      if (!elementsListenersRef.current) {
        elementsListenersRef.current = true;
        shippo.on("ORDER_CREATED", (params: unknown) => {
          const p = params as { order_id?: string };
          if (p?.order_id) shippoOrderIdsRef.current.push(p.order_id);
        });
        shippo.on("LABEL_PURCHASED_SUCCESS", async (transactions: unknown) => {
          const txs = Array.isArray(transactions) ? (transactions as ElementsTransactionPayload[]) : [];
          const orderIds = currentElementsOrderIdsRef.current;
          if (orderIds.length === 0 || txs.length === 0) return;
          const payload = transactionToLabelFromElementsPayload(txs[0], {
            weightOz: DEFAULT_WEIGHT_OZ,
            lengthIn: DEFAULT_LENGTH_IN,
            widthIn: DEFAULT_WIDTH_IN,
            heightIn: DEFAULT_HEIGHT_IN,
          });
          const shippoOrderId = shippoOrderIdsRef.current[0] ?? null;
          try {
            const res = await fetch("/api/shipping/label-from-elements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderIds,
                ...payload,
                ...(shippoOrderId ? { shippoOrderId } : {}),
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              setSelectedOrderIds(new Set());
              setOrders((prev) =>
                prev.map((o) => {
                  if (!orderIds.includes(o.id)) return o;
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
            }
          } catch {
            // ignore
          }
        });
        shippo.on("ERROR", (err: unknown) => {
          const msg = err && typeof err === "object" && "detail" in err ? String((err as { detail: string }).detail) : "Something went wrong.";
          setElementsError(msg);
        });
      }
      const orderDetails = orderDetailsArray.length === 1 ? orderDetailsArray[0] : orderDetailsArray;
      shippo.labelPurchase("#shippo-elements-container", orderDetails);
    } catch {
      setElementsError("Connection failed.");
    } finally {
      setElementsLoading(false);
    }
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
        ) : tab === "to_ship" ? (
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
                            <span className="font-medium">Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}</span>
                            <p className="text-sm text-gray-600">
                              {order.buyer.firstName} {order.buyer.lastName} — {new Date(order.createdAt).toLocaleString()}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              {formatShippingAddress(order.shippingAddress) || "—"}
                            </p>
                            <p className="font-semibold mt-1">${(order.totalCents / 100).toFixed(2)}</p>
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
                  Select orders, then click <strong>Purchase labels</strong>. The label tool opens below—choose carrier, pay, and print.{" "}
                  <Link href={props.shippingSetupHref} className="underline" style={{ color: "var(--color-link)" }}>
                    Connect shipping
                  </Link>{" "}
                  if you haven’t yet.
                </p>

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

                <div id="shippo-elements-container" className="min-h-[200px]" aria-hidden="true" />

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
                              className="font-medium hover:underline"
                              style={{ color: "var(--color-link)" }}
                            >
                              Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}
                            </Link>
                            <p className="text-sm text-gray-600">
                              {order.buyer.firstName} {order.buyer.lastName} — {new Date(order.createdAt).toLocaleString()}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              {formatShippingAddress(order.shippingAddress) || "—"}
                            </p>
                            <p className="font-semibold mt-1">${(order.totalCents / 100).toFixed(2)}</p>
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
                {orders.map((order) => (
                  <li key={order.id} className="border rounded-lg p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <Link
                          href={props.ordersBasePath + "/" + order.id}
                          className="font-medium hover:underline"
                          style={{ color: "var(--color-link)" }}
                        >
                          Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}
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
                        <Link
                          href={props.ordersBasePath + "/" + order.id}
                          className="text-sm mt-2 inline-block hover:underline"
                          style={{ color: "var(--color-link)" }}
                        >
                          Purchase another label
                        </Link>
                      </div>
                      <p className="font-semibold">${(order.totalCents / 100).toFixed(2)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
