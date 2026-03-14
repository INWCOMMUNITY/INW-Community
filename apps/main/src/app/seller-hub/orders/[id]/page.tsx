"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

const SHIPPO_ORG = "inw-community";
const SHIPPO_EMBEDDABLE_URL = "https://js.goshippo.com/embeddable-client.js";

interface Rate {
  id: string;
  carrier: string;
  service: string;
  rateCents: number;
  totalCents: number;
  shipmentId: string;
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
  const [anotherLabelDimensions, setAnotherLabelDimensions] = useState({ weightOz: 16, lengthIn: 12, widthIn: 12, heightIn: 12 });
  const [rates, setRates] = useState<Rate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [purchaseLabelLoading, setPurchaseLabelLoading] = useState(false);
  const [purchaseLabelError, setPurchaseLabelError] = useState<string | null>(null);
  const [elementsLoading, setElementsLoading] = useState(false);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const elementsListenersRef = useRef(false);
  const currentDimensionsRef = useRef(anotherLabelDimensions);
  currentDimensionsRef.current = anotherLabelDimensions;

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

  async function getRatesAnotherLabel() {
    if (!order) return;
    setRatesError(null);
    setRates([]);
    setRatesLoading(true);
    try {
      const res = await fetch("/api/shipping/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          weightOz: anotherLabelDimensions.weightOz,
          lengthIn: anotherLabelDimensions.lengthIn,
          widthIn: anotherLabelDimensions.widthIn,
          heightIn: anotherLabelDimensions.heightIn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRatesError((data as { error?: string }).error ?? "Failed to get rates.");
        return;
      }
      setRates((data as { rates?: Rate[] }).rates ?? []);
    } catch {
      setRatesError("Connection failed.");
    } finally {
      setRatesLoading(false);
    }
  }

  async function purchaseAnotherLabel(rate: Rate) {
    if (!order) return;
    setPurchaseLabelError(null);
    setPurchaseLabelLoading(true);
    try {
      const res = await fetch("/api/shipping/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          rateId: rate.id,
          carrier: rate.carrier,
          service: rate.service,
          rateCents: rate.rateCents,
          weightOz: anotherLabelDimensions.weightOz,
          lengthIn: anotherLabelDimensions.lengthIn,
          widthIn: anotherLabelDimensions.widthIn,
          heightIn: anotherLabelDimensions.heightIn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPurchaseLabelError((data as { error?: string }).error ?? "Failed to purchase label.");
        return;
      }
      setRates([]);
      refetchOrder();
    } catch {
      setPurchaseLabelError("Connection failed.");
    } finally {
      setPurchaseLabelLoading(false);
    }
  }

  async function openElementsFlow() {
    if (!order) return;
    const orderDetails = buildOrderDetailsFromOrder(order);
    if (!orderDetails) {
      setElementsError("Order has no valid shipping address.");
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
      const shippo =
        typeof window !== "undefined"
          ? (window as { shippo?: { init: (o: { token: string; org: string }) => void; labelPurchase: (s: string, d: unknown) => void; on: (ev: string, cb: (arg: unknown) => void) => void } }).shippo
          : null;
      if (!shippo?.init || !shippo?.labelPurchase) {
        setElementsError("Shippo widget is still loading. Try again in a moment.");
        return;
      }
      shippo.init({ token, org: SHIPPO_ORG });
      if (!elementsListenersRef.current) {
        elementsListenersRef.current = true;
        shippo.on("LABEL_PURCHASED_SUCCESS", async (transactions: unknown) => {
          const txs = Array.isArray(transactions) ? (transactions as ElementsTransactionPayload[]) : [];
          if (txs.length === 0 || !order) return;
          const dims = currentDimensionsRef.current;
          const payload = transactionToLabelFromElementsPayload(txs[0], {
            weightOz: dims.weightOz,
            lengthIn: dims.lengthIn,
            widthIn: dims.widthIn,
            heightIn: dims.heightIn,
          });
          try {
            const res = await fetch("/api/shipping/label-from-elements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: order.id, ...payload }),
            });
            if (res.ok) refetchOrder();
          } catch {
            // ignore
          }
        });
        shippo.on("ERROR", (err: unknown) => {
          const msg =
            err && typeof err === "object" && "detail" in err ? String((err as { detail: string }).detail) : "Something went wrong.";
          setElementsError(msg);
        });
      }
      shippo.labelPurchase("#shippo-elements-container-order", orderDetails);
    } catch {
      setElementsError("Connection failed.");
    } finally {
      setElementsLoading(false);
    }
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
      <Script src={SHIPPO_EMBEDDABLE_URL} strategy="lazyOnload" />
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
              <p className="font-bold">${(order.totalCents / 100).toFixed(2)}</p>
              <span
                className="inline-block px-2 py-0.5 rounded text-sm"
                style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
              >
                {getOrderStatusLabel(order.status)}
              </span>
              <span
                className="block mt-1 inline-block px-2 py-0.5 rounded text-xs font-medium"
                style={{
                  backgroundColor: order.stripePaymentIntentId ? "var(--color-section-alt)" : "#fef3c7",
                  color: order.stripePaymentIntentId ? "var(--color-primary)" : "#92400e",
                }}
              >
                {order.stripePaymentIntentId ? "Paid: Online NWC" : "Awaiting Payment: Cash"}
              </span>
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
              {elementsError && <p className="text-sm text-amber-700 mb-2">{elementsError}</p>}
              <button
                type="button"
                onClick={openElementsFlow}
                disabled={elementsLoading}
                className="btn text-sm py-2 px-4 disabled:opacity-50"
              >
                {elementsLoading ? "Opening Shippo…" : "Purchase label with Shippo"}
              </button>
              <div id="shippo-elements-container-order" className="min-h-[200px] mt-4" aria-hidden="true" />
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
                <p className="font-medium mb-2">Purchase another label</p>
                {elementsError && <p className="text-sm text-amber-700 mb-2">{elementsError}</p>}
                <div className="flex flex-wrap gap-4 items-center mb-3">
                  <button
                    type="button"
                    onClick={openElementsFlow}
                    disabled={elementsLoading}
                    className="btn text-sm py-2 px-4 disabled:opacity-50"
                  >
                    {elementsLoading ? "Opening Shippo…" : "Purchase label with Shippo"}
                  </button>
                  <span className="text-sm text-gray-500">or use classic flow:</span>
                </div>
                <p className="text-sm text-gray-600 mb-3">
                  Get a new label (e.g. replacement). Enter dimensions and get rates.
                </p>
                <div className="flex flex-wrap gap-4 items-end mb-3">
                  <label className="flex items-center gap-2 text-sm">
                    <span>Weight (oz)</span>
                    <input
                      type="number"
                      min={1}
                      value={anotherLabelDimensions.weightOz}
                      onChange={(e) =>
                        setAnotherLabelDimensions((d) => ({ ...d, weightOz: Number(e.target.value) || 1 }))
                      }
                      className="border rounded px-2 py-1 w-20"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <span>L×W×H (in)</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={anotherLabelDimensions.lengthIn}
                      onChange={(e) =>
                        setAnotherLabelDimensions((d) => ({ ...d, lengthIn: Number(e.target.value) || 1 }))
                      }
                      className="border rounded px-2 py-1 w-16"
                    />
                    <span>×</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={anotherLabelDimensions.widthIn}
                      onChange={(e) =>
                        setAnotherLabelDimensions((d) => ({ ...d, widthIn: Number(e.target.value) || 1 }))
                      }
                      className="border rounded px-2 py-1 w-16"
                    />
                    <span>×</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={anotherLabelDimensions.heightIn}
                      onChange={(e) =>
                        setAnotherLabelDimensions((d) => ({ ...d, heightIn: Number(e.target.value) || 1 }))
                      }
                      className="border rounded px-2 py-1 w-16"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={getRatesAnotherLabel}
                    disabled={ratesLoading}
                    className="btn text-sm py-2 px-4 disabled:opacity-50"
                  >
                    {ratesLoading ? "Getting rates…" : "Get rates (classic)"}
                  </button>
                </div>
                <div id="shippo-elements-container-order" className="min-h-[200px] my-4" aria-hidden="true" />
                {ratesError && (
                  <p className="text-sm text-amber-700 mb-2">{ratesError}</p>
                )}
                {purchaseLabelError && (
                  <p className="text-sm text-red-600 mb-2">{purchaseLabelError}</p>
                )}
                {rates.length > 0 && (
                  <div className="space-y-2 mt-2">
                    <p className="text-sm font-medium">Select a rate:</p>
                    <ul className="space-y-1">
                      {rates.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-4 py-2 border-b border-gray-100">
                          <span className="text-sm">
                            {r.carrier} {r.service} — ${(r.rateCents / 100).toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => purchaseAnotherLabel(r)}
                            disabled={purchaseLabelLoading}
                            className="btn text-sm py-1.5 px-3 disabled:opacity-50"
                          >
                            {purchaseLabelLoading ? "Purchasing…" : "Purchase label"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
