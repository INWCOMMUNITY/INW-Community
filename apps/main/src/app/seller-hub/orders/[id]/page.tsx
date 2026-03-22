"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import Script from "next/script";
import { useParams } from "next/navigation";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";
import {
  buildOrderDetailsFromOrder,
  transactionToLabelFromElementsPayload,
  type ElementsTransactionPayload,
} from "@/lib/shippo-elements";
import {
  NWC_SHIPPO_ELEMENTS_THEME,
  type ShippoElementsTheme,
} from "@/lib/shippo-elements-theme";
import { ShippoElementsModal } from "@/components/ShippoElementsModal";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";

const SHIPPO_ORG = "inw-community";
const SHIPPO_CONTAINER_ID = "shippo-elements-container-order";
const SHIPPO_EMBEDDABLE_URL = "https://js.goshippo.com/embeddable-client.js";

type ShippoWidget = {
  init: (o: { token: string; org: string; theme?: ShippoElementsTheme }) => void;
  labelPurchase: (s: string, d: unknown) => void;
  on: (ev: string, cb: (arg: unknown) => void) => void;
};

function isShippoReady(shippo: ShippoWidget | undefined): shippo is ShippoWidget {
  return (
    shippo != null &&
    typeof shippo.init === "function" &&
    typeof shippo.labelPurchase === "function"
  );
}

function waitForShippo(): Promise<ShippoWidget | null> {
  return new Promise((resolve) => {
    const win = typeof window !== "undefined" ? (window as { shippo?: ShippoWidget }) : null;
    if (win?.shippo != null && isShippoReady(win.shippo)) {
      resolve(win.shippo);
      return;
    }
    let attempts = 0;
    const maxAttempts = 120; // 12s at 100ms
    const interval = setInterval(() => {
      const w = typeof window !== "undefined" ? (window as { shippo?: ShippoWidget }) : null;
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

function sellerOrderTotalLine(order: Pick<StoreOrder, "orderKind" | "totalCents">): string {
  if (order.orderKind === "reward_redemption" && order.totalCents === 0) {
    return "No charge to member (reward)";
  }
  return `$${(order.totalCents / 100).toFixed(2)}`;
}

function getTrackingUrl(carrier: string, trackingNumber: string): string {
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  return `https://www.google.com/search?q=track+${trackingNumber}`;
}

export default function SellerOrderDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [elementsLoading, setElementsLoading] = useState(false);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const [shippoModalOpen, setShippoModalOpen] = useState(false);
  const elementsListenersRef = useRef(false);
  const shippoOrderIdFromCreatedRef = useRef<string | null>(null);

  const refetchOrder = useCallback(() => {
    if (!id) return;
    fetch(`/api/store-orders/${id}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return null;
        return data as StoreOrder;
      })
      .then((data) => data && setOrder(data));
  }, [id]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setFetchError(null);
    fetch(`/api/store-orders/${id}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setFetchError((data as { error?: string }).error ?? "Failed to load order.");
          return null;
        }
        return data as StoreOrder;
      })
      .then(setOrder)
      .catch(() => {
        setFetchError("Connection failed.");
        setOrder(null);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function openElementsFlow(options: { forReprint?: boolean } = {}) {
    if (!order) return;
    const objectId = options.forReprint ? order.shipment?.shippoOrderId : undefined;
    const orderDetails = buildOrderDetailsFromOrder(order, objectId, {
      freshShippoOrder: Boolean(order.shipment) && !options.forReprint,
    });
    if (!orderDetails) {
      setElementsError("Order has no valid shipping address.");
      return;
    }
    setElementsError(null);
    setElementsLoading(true);
    shippoOrderIdFromCreatedRef.current = null;
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
      let shippo =
        typeof window !== "undefined"
          ? (window as { shippo?: ShippoWidget }).shippo
          : null;
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
      if (!elementsListenersRef.current) {
        elementsListenersRef.current = true;
        shippo.on("ORDER_CREATED", (params: unknown) => {
          const p = params as { order_id?: string };
          if (p?.order_id) shippoOrderIdFromCreatedRef.current = p.order_id;
        });
        shippo.on("LABEL_PURCHASED_SUCCESS", async (transactions: unknown) => {
          const txs = Array.isArray(transactions) ? (transactions as ElementsTransactionPayload[]) : [];
          if (txs.length === 0 || !order) return;
          const payload = transactionToLabelFromElementsPayload(txs[0], {
            weightOz: 16,
            lengthIn: 12,
            widthIn: 12,
            heightIn: 12,
          });
          const shippoOrderId =
            shippoOrderIdFromCreatedRef.current ?? order.shipment?.shippoOrderId ?? null;
          try {
            const res = await fetch("/api/shipping/label-from-elements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: order.id,
                ...payload,
                ...(shippoOrderId ? { shippoOrderId } : {}),
              }),
            });
            const saveData = await res.json().catch(() => ({}));
            if (res.ok) {
              refetchOrder();
            } else {
              setElementsError(
                typeof (saveData as { error?: string }).error === "string"
                  ? (saveData as { error: string }).error
                  : "Could not save label to your order. If you were charged, contact support with your order number."
              );
            }
          } catch {
            setElementsError("Could not save label to your order.");
          }
        });
        shippo.on("ERROR", (err: unknown) => {
          const msg =
            err && typeof err === "object" && "detail" in err ? String((err as { detail: string }).detail) : "Something went wrong.";
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

  function closeShippoModal() {
    setShippoModalOpen(false);
  }

  if (loading) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <p className="text-gray-500">Loading…</p>
        </div>
      </section>
    );
  }

  if (fetchError || !order) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <Link href="/seller-hub/orders" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
            ← Back to Orders
          </Link>
          <div className="border rounded-lg p-6 bg-red-50">
            <p className="text-red-700">{fetchError ?? "Order not found."}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <Script src={SHIPPO_EMBEDDABLE_URL} strategy="afterInteractive" />
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/seller-hub/orders" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Orders
        </Link>
        <div className="border rounded-lg p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm text-gray-500">
                Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}
              </p>
              <p className="font-semibold">
                {order.buyer.firstName} {order.buyer.lastName}
              </p>
              <p className="text-sm text-gray-600">{order.buyer.email}</p>
              <p className="text-sm text-gray-500 mt-1">
                {new Date(order.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold">{sellerOrderTotalLine(order)}</p>
              <div className="mt-1 flex flex-col items-end gap-1">
                <span
                  className="inline-block px-2 py-0.5 rounded text-sm"
                  style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                >
                  {getOrderStatusLabel(order.status)}
                </span>
                {order.orderKind === "reward_redemption" && order.totalCents === 0 ? (
                  <span
                    className="inline-block px-2 py-0.5 rounded text-sm font-medium"
                    style={{ backgroundColor: "#ecfdf5", color: "#065f46" }}
                  >
                    Reward — shipping never charged to member
                  </span>
                ) : (
                  <span
                    className="inline-block px-2 py-0.5 rounded text-sm font-medium"
                    style={{
                      backgroundColor: order.stripePaymentIntentId ? "var(--color-section-alt)" : "#fef3c7",
                      color: order.stripePaymentIntentId ? "var(--color-primary)" : "#92400e",
                    }}
                  >
                    {order.stripePaymentIntentId ? "Paid: Online NWC" : "Awaiting Payment: Cash"}
                  </span>
                )}
              </div>
            </div>
          </div>
          {order.shippingAddress != null && typeof order.shippingAddress === "object" && (
            <div className="text-sm text-gray-600 mb-4">
              <p className="font-medium">Shipping address</p>
              <p className="mt-1 font-sans whitespace-pre-wrap">
                {formatShippingAddress(order.shippingAddress)}
              </p>
            </div>
          )}
          {order.status === "paid" && !order.shipment && (
            <div className="border-t pt-4 mb-4">
              <p className="font-medium mb-2">Purchase shipping label</p>
              <p className="text-sm text-gray-600 mb-2">Choose carrier in the popup, pay with your Shippo account, then print or download the label.</p>
              {elementsError && <p className="text-sm text-amber-700 mb-2">{elementsError}</p>}
              <button
                type="button"
                onClick={() => openElementsFlow()}
                disabled={elementsLoading}
                className="btn text-sm py-2 px-4 disabled:opacity-50"
              >
                {elementsLoading ? "Opening…" : "Purchase labels"}
              </button>
            </div>
          )}
          <div className="border-t pt-4">
            <p className="font-medium mb-2">Items</p>
            <ul className="space-y-2">
              {order.items.map((oi) => (
                <li key={oi.id} className="flex items-center gap-2">
                  {oi.storeItem.photos[0] && (
                    <img
                      src={oi.storeItem.photos[0]}
                      alt=""
                      className="w-10 h-10 object-cover rounded"
                    />
                  )}
                  <span>
                    {oi.storeItem.title} × {oi.quantity} — $
                    {((oi.priceCentsAtPurchase * oi.quantity) / 100).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {order.shipment && (
            <>
              <div className="border-t pt-4 mb-4">
                <p className="font-medium mb-2">Shipping</p>
                <p className="text-sm text-gray-600">
                  {order.shipment.carrier} {order.shipment.service}
                </p>
                {order.shipment.trackingNumber && (
                  <p className="text-sm mt-1">
                    <span className="font-medium">Tracking:</span>{" "}
                    <a
                      href={getTrackingUrl(order.shipment.carrier, order.shipment.trackingNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      style={{ color: "var(--color-link)" }}
                    >
                      {order.shipment.trackingNumber}
                    </a>
                  </p>
                )}
              </div>
              <div className="border-t pt-4">
                <p className="font-medium mb-2">Labels</p>
                {elementsError && <p className="text-sm text-amber-700 mb-2">{elementsError}</p>}
                <div className="flex flex-wrap gap-3 mb-3">
                  {order.shipment?.shippoOrderId &&
                  isWithinLabelReprintWindow(order.shipment.createdAt) ? (
                    <button
                      type="button"
                      onClick={() => openElementsFlow({ forReprint: true })}
                      disabled={elementsLoading}
                      className="btn text-sm py-2 px-4 disabled:opacity-50"
                    >
                      {elementsLoading ? "Opening…" : "Reprint label"}
                    </button>
                  ) : null}
                  {order.shipment?.labelUrl &&
                  isWithinLabelReprintWindow(order.shipment.createdAt) ? (
                    <a
                      href={order.shipment.labelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn text-sm py-2 px-4 inline-block text-center"
                    >
                      Open label PDF
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openElementsFlow()}
                    disabled={elementsLoading}
                    className="btn text-sm py-2 px-4 disabled:opacity-50"
                  >
                    {elementsLoading ? "Opening…" : "Purchase another label"}
                  </button>
                </div>
                <p className="text-sm text-gray-600 mb-3">
                  Reprint and PDF download are available for 24 hours after you buy a label. Purchase another label starts a new label (e.g. replacement) and updates tracking when you complete purchase.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <ShippoElementsModal
        open={shippoModalOpen}
        onClose={closeShippoModal}
        containerId={SHIPPO_CONTAINER_ID}
        title="Shippo — label"
      />
    </section>
  );
}
