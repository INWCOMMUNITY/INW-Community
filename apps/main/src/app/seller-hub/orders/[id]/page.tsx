"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";

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
          )}
        </div>
      </div>
    </section>
  );
}
