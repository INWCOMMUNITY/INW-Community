"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { OrderCardItemRows } from "@/components/fulfillment/OrderCard";
import type { FulfillmentStoreOrder } from "@/components/fulfillment/types";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";
import {
  formatSellerOrderTotal,
  getTrackingUrl,
  orderHasShippedLine,
  sellerOrderPaymentLabel,
} from "@/lib/store-order-fulfillment";
import { orderEligibleForAnotherShippoLabel } from "types";

function shippoLabelHref(orderId: string, labelAction: "purchase" | "reprint" | "another") {
  const q = new URLSearchParams({ labelAction });
  return `/seller-hub/orders/shippo/${orderId}?${q.toString()}`;
}

export default function SellerOrderDetailPage() {
  return (
    <Suspense
      fallback={
        <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
          <div className="max-w-[var(--max-width)] mx-auto">
            <p className="text-gray-500">Loading…</p>
          </div>
        </section>
      }
    >
      <SellerOrderDetailInner />
    </Suspense>
  );
}

function SellerOrderDetailInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const rawId = params?.id;
  const id =
    typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";
  const backTab = searchParams.get("tab") === "history" ? "history" : "ship";
  const backHref = `/seller-hub/orders${backTab === "history" ? "?tab=history" : backTab === "ship" ? "" : `?tab=${backTab}`}`;

  const [order, setOrder] = useState<FulfillmentStoreOrder | null>(null);
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
        return data as FulfillmentStoreOrder;
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
          <Link href={backHref} className="text-sm text-gray-600 hover:underline mb-4 inline-block">
            ← Back to Fulfillment
          </Link>
          <div className="border rounded-lg p-6 bg-red-50">
            <p className="text-red-700">{fetchError ?? "Order not found."}</p>
          </div>
        </div>
      </section>
    );
  }

  const orderNum = order.orderNumber ?? order.id.slice(-8).toUpperCase();
  const paymentLabel = sellerOrderPaymentLabel(order);
  const needsLabel = order.status === "paid" && !order.shipment && orderHasShippedLine(order.items);
  const canReprint =
    order.shipment?.createdAt && isWithinLabelReprintWindow(order.shipment.createdAt);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href={backHref} className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Fulfillment
        </Link>

        <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-6">
            <div>
              <p className="text-sm text-gray-500">Order #{orderNum}</p>
              <h1 className="text-xl font-bold text-gray-900 mt-1">
                {order.buyer.firstName} {order.buyer.lastName}
              </h1>
              <p className="text-sm text-gray-600">{order.buyer.email}</p>
              <p className="text-sm text-gray-500 mt-1">{new Date(order.createdAt).toLocaleString()}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span
                  className="inline-block px-2 py-0.5 rounded text-sm"
                  style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                >
                  {getOrderStatusLabel(order.status)}
                </span>
                <span className="inline-block px-2 py-0.5 rounded text-sm bg-gray-100 text-gray-700">
                  {paymentLabel}
                </span>
                {order.orderKind === "reward_redemption" && order.totalCents === 0 ? (
                  <span className="inline-block px-2 py-0.5 rounded text-sm font-medium bg-emerald-50 text-emerald-800">
                    Reward — no charge
                  </span>
                ) : null}
              </div>
            </div>

            {order.shippingAddress != null && typeof order.shippingAddress === "object" ? (
              <div>
                <p className="font-medium text-gray-900 mb-1">Shipping address</p>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">
                  {formatShippingAddress(order.shippingAddress)}
                </p>
              </div>
            ) : null}

            <div>
              <p className="font-medium text-gray-900 mb-3">Items</p>
              <OrderCardItemRows order={order} />
            </div>

            <div className="border-t pt-4 flex justify-between items-center">
              <span className="font-medium text-gray-900">Order total</span>
              <span className="text-lg font-bold">{formatSellerOrderTotal(order)}</span>
            </div>
          </div>

          <aside className="rounded-xl border border-gray-200 bg-gray-50 p-5 shadow-sm space-y-4 lg:sticky lg:top-24">
            <h2 className="font-semibold text-gray-900">Fulfillment</h2>

            {needsLabel ? (
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Purchase a label with your connected Shippo account, or mark shipped if you used your own carrier.
                </p>
                <Link
                  href={shippoLabelHref(order.id, "purchase")}
                  className="action-pill action-pill-lg btn-pill-primary w-full justify-center mb-2"
                >
                  Purchase label
                </Link>
              </div>
            ) : null}

            {order.shipment ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  {order.shipment.carrier} {order.shipment.service ?? ""}
                </p>
                {order.shipment.trackingNumber ? (
                  <a
                    href={getTrackingUrl(order.shipment.carrier, order.shipment.trackingNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline block"
                    style={{ color: "var(--color-link)" }}
                  >
                    Track {order.shipment.trackingNumber}
                  </a>
                ) : null}
                <div className="flex flex-col gap-2">
                  {canReprint && order.shipment.shippoOrderId ? (
                    <Link
                      href={shippoLabelHref(order.id, "reprint")}
                      className="action-pill btn-pill-outline w-full justify-center text-sm"
                    >
                      Reprint label
                    </Link>
                  ) : null}
                  {canReprint && order.shipment.labelUrl ? (
                    <a
                      href={order.shipment.labelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="action-pill btn-pill-outline w-full justify-center text-sm"
                    >
                      Open label PDF
                    </a>
                  ) : null}
                  {orderEligibleForAnotherShippoLabel(order) ? (
                    <Link
                      href={shippoLabelHref(order.id, "another")}
                      className="action-pill btn-pill-outline w-full justify-center text-sm"
                    >
                      Purchase another label
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!needsLabel && !order.shipment ? (
              <p className="text-sm text-gray-600">
                Pickup and delivery actions are available from the Fulfillment hub tabs.
              </p>
            ) : null}

            <Link
              href={`${backHref}`}
              className="text-sm font-medium hover:underline inline-block"
              style={{ color: "var(--color-link)" }}
            >
              Back to hub
            </Link>
          </aside>
        </div>
      </div>
    </section>
  );
}
