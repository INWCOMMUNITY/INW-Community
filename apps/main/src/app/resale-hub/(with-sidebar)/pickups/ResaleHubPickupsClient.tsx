"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getErrorMessage } from "@/lib/api-error";

interface OrderWithPickup {
  id: string;
  orderNumber?: string;
  createdAt: string;
  totalCents: number;
  stripePaymentIntentId?: string | null;
  deliveryConfirmedAt: string | null;
  buyer: { firstName: string; lastName: string; email: string };
  items: { storeItem: { title: string }; quantity: number; fulfillmentType?: string | null }[];
}

function hasPickupItems(order: OrderWithPickup) {
  return order.items?.some((i) => i.fulfillmentType === "pickup") ?? false;
}

function paymentTag(order: OrderWithPickup) {
  return order.stripePaymentIntentId ? "Paid: Online NWC" : "Awaiting Payment: Cash";
}

export function ResaleHubPickupsClient() {
  const [orders, setOrders] = useState<OrderWithPickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    fetch("/api/store-orders?mine=1")
      .then((r) => r.json())
      .then((data: OrderWithPickup[]) => {
        const all = Array.isArray(data) ? data : [];
        const withPickup = all.filter(hasPickupItems);
        setOrders(withPickup);
      })
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  async function markPickedUp(orderId: string) {
    setError("");
    setConfirmingId(orderId);
    try {
      const res = await fetch(`/api/store-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryConfirmed: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(getErrorMessage(data.error, "Failed to update"));
        return;
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, deliveryConfirmedAt: new Date().toISOString() } : o
        )
      );
    } finally {
      setConfirmingId(null);
    }
  }

  const pending = orders.filter((o) => !o.deliveryConfirmedAt);
  const completed = orders.filter((o) => o.deliveryConfirmedAt);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">My Pickups</h1>
        <p className="text-gray-500">Loading…</p>
        <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline mt-4 inline-block">
          Back to Resale Hub
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Pickups</h1>
      <p className="text-gray-600 mb-6">
        Orders with in-store pickup. Mark as picked up when the buyer has collected the item.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {orders.length === 0 ? (
        <>
          <p className="text-gray-600">You have no orders with pickup.</p>
          <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline mt-4 inline-block">
            Back to Resale Hub
          </Link>
        </>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">Pending pickup</h2>
              <div className="overflow-x-auto">
                <table className="w-full border border-gray-200 rounded-lg overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-3 text-sm font-medium">Order / Date</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Payment</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Buyer</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Items</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((o) => (
                      <tr key={o.id} className="border-t border-gray-200">
                        <td className="py-2 px-3 text-sm">
                          <span className="font-mono text-gray-600">
                            #{o.orderNumber ?? o.id.slice(-8)}
                          </span>
                          <br />
                          <span className="text-gray-500">
                            {new Date(o.createdAt).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-sm">
                          <span
                            className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                            style={{
                              backgroundColor: o.stripePaymentIntentId ? "var(--color-section-alt)" : "#fef3c7",
                              color: o.stripePaymentIntentId ? "var(--color-primary)" : "#92400e",
                            }}
                          >
                            {paymentTag(o)}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-sm">
                          {o.buyer?.firstName} {o.buyer?.lastName}
                          {o.buyer?.email && (
                            <span className="block text-gray-500 text-xs">{o.buyer.email}</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-sm">
                          {o.items?.map((i, idx) => (
                            <span key={idx}>
                              {i.storeItem?.title} × {i.quantity}
                            </span>
                          )) ?? "—"}
                        </td>
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() => markPickedUp(o.id)}
                            disabled={confirmingId === o.id}
                            className="btn text-sm py-1.5 px-3 disabled:opacity-50"
                          >
                            {confirmingId === o.id ? "Saving…" : "Mark as picked up"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {completed.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowCompleted((c) => !c)}
                className="text-sm font-medium text-gray-600 hover:underline mb-2"
              >
                {showCompleted ? "Hide" : "Show"} completed pickups ({completed.length})
              </button>
              {showCompleted && (
                <div className="overflow-x-auto">
                  <table className="w-full border border-gray-200 rounded-lg overflow-hidden">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left py-2 px-3 text-sm font-medium">Order / Date</th>
                        <th className="text-left py-2 px-3 text-sm font-medium">Buyer</th>
                        <th className="text-left py-2 px-3 text-sm font-medium">Picked up</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completed.map((o) => (
                        <tr key={o.id} className="border-t border-gray-200">
                          <td className="py-2 px-3 text-sm">
                            <span className="font-mono text-gray-600">
                              #{o.orderNumber ?? o.id.slice(-8)}
                            </span>
                            <br />
                            <span className="text-gray-500">
                              {new Date(o.createdAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-sm">
                            {o.buyer?.firstName} {o.buyer?.lastName}
                          </td>
                          <td className="py-2 px-3 text-sm text-gray-500">
                            {o.deliveryConfirmedAt
                              ? new Date(o.deliveryConfirmedAt).toLocaleDateString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline mt-6 inline-block">
            Back to Resale Hub
          </Link>
        </>
      )}
    </div>
  );
}
