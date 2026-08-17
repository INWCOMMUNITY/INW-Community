"use client";

import { useState } from "react";
import { getErrorMessage } from "@/lib/api-error";
import {
  filterOrdersForPickupTab,
  orderHasPickupLine,
  sellerOrderPaymentLabel,
} from "@/lib/store-order-fulfillment";
import { OrderCard } from "./OrderCard";
import { OrderEmptyState } from "./OrderEmptyState";
import type { FulfillmentStoreOrder } from "./types";

type PickupQueueSectionProps = {
  orders: FulfillmentStoreOrder[];
  ordersBasePath: string;
  onOrderUpdated: (order: FulfillmentStoreOrder) => void;
};

export function PickupQueueSection({ orders, ordersBasePath, onOrderUpdated }: PickupQueueSectionProps) {
  const pickupOrders = filterOrdersForPickupTab(orders);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const pending = pickupOrders.filter((o) => !o.pickupSellerConfirmedAt);
  const completed = pickupOrders.filter((o) => !!o.pickupSellerConfirmedAt);

  async function markPickedUp(orderId: string) {
    setError("");
    setConfirmingId(orderId);
    try {
      const res = await fetch(`/api/store-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickupSellerConfirmed: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to update"));
        return;
      }
      const existing = pickupOrders.find((o) => o.id === orderId);
      if (existing) {
        onOrderUpdated({
          ...existing,
          pickupSellerConfirmedAt: new Date().toISOString(),
          status: (data as { status?: string }).status ?? existing.status,
        });
      }
    } finally {
      setConfirmingId(null);
    }
  }

  if (pickupOrders.length === 0) {
    return <OrderEmptyState tab="pickups" />;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Orders with in-store pickup. Mark as picked up when the buyer collects their items.
      </p>

      {error ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
      ) : null}

      {pending.length > 0 ? (
        <section>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Pending pickup</h2>
          <ul className="space-y-3">
            {pending.map((order) => (
              <li key={order.id}>
                <OrderCard
                  order={order}
                  ordersBasePath={ordersBasePath}
                  trailing={
                    <button
                      type="button"
                      onClick={() => void markPickedUp(order.id)}
                      disabled={confirmingId === order.id}
                      className="mt-3 btn text-sm py-2 px-4 disabled:opacity-50"
                    >
                      {confirmingId === order.id ? "Saving…" : "Mark as picked up"}
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-gray-500">No pending pickups.</p>
      )}

      {completed.length > 0 ? (
        <section>
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="text-sm font-medium text-gray-600 hover:underline mb-3"
          >
            {showCompleted ? "Hide" : "Show"} completed pickups ({completed.length})
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

/** Client-side filter helper exported for counts. */
export function countPickupOrders(orders: FulfillmentStoreOrder[]): number {
  return filterOrdersForPickupTab(orders).filter((o) => orderHasPickupLine(o.items) && !o.pickupSellerConfirmedAt)
    .length;
}
