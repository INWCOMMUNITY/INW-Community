"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";
import { orderEligibleForAnotherShippoLabel } from "types";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";

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

function shippoLabelHref(orderId: string, labelAction: "purchase" | "reprint" | "another") {
  const q = new URLSearchParams({ labelAction });
  return `/seller-hub/orders/shippo/${orderId}?${q.toString()}`;
}

export default function SellerOrderDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const id =
    typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

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
          {order.status === "paid" && !order.shipment && orderHasShippedLine(order.items) && (
            <div className="border-t pt-4 mb-4">
              <p className="font-medium mb-2">Purchase shipping label</p>
              <p className="text-sm text-gray-600 mb-2">
                Opens the label page where you choose a carrier, pay with your Shippo account, then print or download.
              </p>
              <Link href={shippoLabelHref(order.id, "purchase")} className="btn text-sm py-2 px-4 inline-block text-center">
                Purchase labels
              </Link>
            </div>
          )}
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
              <div className="border-t pt-4 mb-4">
                <p className="font-medium mb-2">Labels</p>
                <div className="flex flex-wrap gap-3 mb-3">
                  {order.shipment?.shippoOrderId &&
                  order.shipment.createdAt &&
                  isWithinLabelReprintWindow(order.shipment.createdAt) ? (
                    <Link
                      href={shippoLabelHref(order.id, "reprint")}
                      className="btn text-sm py-2 px-4 inline-block text-center"
                    >
                      Reprint label
                    </Link>
                  ) : null}
                  {order.shipment?.labelUrl && order.shipment.createdAt && isWithinLabelReprintWindow(order.shipment.createdAt) ? (
                    <a
                      href={order.shipment.labelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn text-sm py-2 px-4 inline-block text-center"
                    >
                      Open label PDF
                    </a>
                  ) : null}
                  {orderEligibleForAnotherShippoLabel(order) ? (
                    <Link
                      href={shippoLabelHref(order.id, "another")}
                      className="btn text-sm py-2 px-4 inline-block text-center"
                    >
                      Purchase another label
                    </Link>
                  ) : null}
                </div>
                <p className="text-sm text-gray-600 mb-3">
                  Reprint and PDF download are available for 24 hours after you buy a label. Purchase another label
                  starts a new label (e.g. replacement) and updates tracking when you complete purchase.
                </p>
              </div>
            </>
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
        </div>
      </div>
    </section>
  );
}
