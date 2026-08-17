"use client";

import { useState } from "react";
import { getErrorMessage } from "@/lib/api-error";
import { filterOrdersForDeliveryTab } from "@/lib/store-order-fulfillment";
import { OrderCard } from "./OrderCard";
import { OrderEmptyState } from "./OrderEmptyState";
import type { FulfillmentStoreOrder, LocalDeliveryDetails } from "./types";

function sellerCanMarkLocalDelivery(o: FulfillmentStoreOrder): boolean {
  if (o.deliveryConfirmedAt) return false;
  return ["paid", "shipped", "delivered"].includes(o.status);
}

function canSellerCancelDelivery(o: FulfillmentStoreOrder): boolean {
  if (o.status !== "paid") return false;
  if (o.deliveryConfirmedAt) return false;
  if (!o.localDeliveryDetails) return false;
  return (o.items ?? []).some((i) => (i.fulfillmentType ?? "") === "local_delivery");
}

function formatDeliveryAddress(d: LocalDeliveryDetails | null | undefined): string {
  const addr = d?.deliveryAddress;
  if (!addr) return "—";
  return [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ") || "—";
}

type DeliveryQueueSectionProps = {
  orders: FulfillmentStoreOrder[];
  ordersBasePath: string;
  onOrderUpdated: (order: FulfillmentStoreOrder) => void;
  onOrderRemoved: (orderId: string) => void;
};

export function DeliveryQueueSection({
  orders,
  ordersBasePath,
  onOrderUpdated,
  onOrderRemoved,
}: DeliveryQueueSectionProps) {
  const deliveryOrders = filterOrdersForDeliveryTab(orders);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  const pending = deliveryOrders.filter((o) => !(o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt));
  const completed = deliveryOrders.filter((o) => o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt);

  async function markDelivered(orderId: string) {
    setError("");
    setConfirmingId(orderId);
    try {
      const res = await fetch(`/api/store-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryConfirmed: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to update"));
        return;
      }
      const existing = deliveryOrders.find((o) => o.id === orderId);
      if (existing) {
        onOrderUpdated({
          ...existing,
          deliveryConfirmedAt: new Date().toISOString(),
          status: (data as { status?: string }).status ?? existing.status,
        });
      }
    } finally {
      setConfirmingId(null);
    }
  }

  async function cancelLocalDelivery(orderId: string) {
    const o = deliveryOrders.find((x) => x.id === orderId);
    const paidOnline = Boolean(o?.stripePaymentIntentId);
    const ok = window.confirm(
      paidOnline
        ? "Cancel this delivery? The buyer will be refunded to their card and inventory will be restored."
        : "Cancel this cash delivery order? Inventory will be restored. Confirm with the buyer if they already paid you in person."
    );
    if (!ok) return;
    setMenuOpenId(null);
    setCancelingId(orderId);
    setError("");
    try {
      const res = await fetch(`/api/store-orders/${orderId}/seller-cancel-local-delivery`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Could not cancel"));
        return;
      }
      onOrderRemoved(orderId);
    } finally {
      setCancelingId(null);
    }
  }

  if (deliveryOrders.length === 0) {
    return <OrderEmptyState tab="deliveries" />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Orders with local delivery. Mark as delivered when you complete the drop-off.
      </p>

      {error ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
      ) : null}

      {pending.length > 0 ? (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Pending delivery</h2>
          <ul className="space-y-3">
            {pending.map((order) => {
              const d = order.localDeliveryDetails;
              return (
                <li key={order.id}>
                  <OrderCard
                    order={order}
                    ordersBasePath={ordersBasePath}
                    trailing={
                      <div className="mt-3 space-y-2 text-sm text-gray-600">
                        <p>
                          <span className="font-medium">Deliver to:</span> {d?.firstName} {d?.lastName}
                        </p>
                        <p>{formatDeliveryAddress(d)}</p>
                        {d?.phone ? <p>Phone: {d.phone}</p> : null}
                        {d?.note ? <p className="text-gray-500">Note: {d.note}</p> : null}
                        {!order.deliveryConfirmedAt && sellerCanMarkLocalDelivery(order) ? (
                          <button
                            type="button"
                            onClick={() => void markDelivered(order.id)}
                            disabled={confirmingId === order.id}
                            className="btn text-sm py-2 px-4 disabled:opacity-50"
                          >
                            {confirmingId === order.id ? "Saving…" : "Mark delivered"}
                          </button>
                        ) : !order.deliveryConfirmedAt ? (
                          <span className="text-xs text-amber-800">
                            {order.status === "pending"
                              ? "Awaiting payment — mark delivered after the order is paid."
                              : "Can't mark delivered in this state."}
                          </span>
                        ) : null}
                      </div>
                    }
                    menu={
                      canSellerCancelDelivery(order) ? (
                        <div className="relative">
                          <button
                            type="button"
                            className="w-9 h-9 rounded border border-gray-300 text-lg leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            aria-label="Delivery options"
                            disabled={cancelingId === order.id}
                            onClick={() => setMenuOpenId((id) => (id === order.id ? null : order.id))}
                          >
                            ⋮
                          </button>
                          {menuOpenId === order.id ? (
                            <>
                              <button
                                type="button"
                                className="fixed inset-0 z-40 cursor-default"
                                aria-label="Close menu"
                                onClick={() => setMenuOpenId(null)}
                              />
                              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-48 text-sm">
                                <button
                                  type="button"
                                  className="block w-full text-left px-3 py-2 hover:bg-red-50 text-red-700 font-medium"
                                  onClick={() => void cancelLocalDelivery(order.id)}
                                >
                                  Cancel delivery
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      ) : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-gray-500">No pending deliveries.</p>
      )}

      {completed.length > 0 ? (
        <section>
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="text-sm font-medium text-gray-600 hover:underline mb-3"
          >
            {showCompleted ? "Hide" : "Show"} completed deliveries ({completed.length})
          </button>
          {showCompleted ? (
            <ul className="space-y-3">
              {completed.map((order) => (
                <li key={order.id}>
                  <OrderCard order={order} ordersBasePath={ordersBasePath} showStatus />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function countPendingDeliveryOrders(orders: FulfillmentStoreOrder[]): number {
  return filterOrdersForDeliveryTab(orders).filter(
    (o) => !(o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt)
  ).length;
}
