"use client";

import { useState, useEffect } from "react";
import { getErrorMessage } from "@/lib/api-error";

interface LocalDeliveryDetails {
  firstName?: string;
  lastName?: string;
  phone?: string;
  deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  note?: string;
}

interface OrderWithDelivery {
  id: string;
  createdAt: string;
  totalCents: number;
  localDeliveryDetails: LocalDeliveryDetails | null;
  deliveryConfirmedAt: string | null;
  items: { storeItem: { title: string }; quantity: number }[];
}

export default function MyDeliveriesPage() {
  const [orders, setOrders] = useState<OrderWithDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    fetch("/api/store-orders?mine=1")
      .then((r) => r.json())
      .then((data: OrderWithDelivery[]) => {
        const withDelivery = (Array.isArray(data) ? data : []).filter(
          (o) => o.localDeliveryDetails != null && typeof o.localDeliveryDetails === "object"
        );
        setOrders(withDelivery);
      })
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  async function markDelivered(orderId: string) {
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
        <h1 className="text-2xl font-bold mb-4">My Deliveries</h1>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Deliveries</h1>
      <p className="text-gray-600 mb-6">
        Orders that include local delivery. Mark as delivered when you have completed the delivery.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {orders.length === 0 ? (
        <p className="text-gray-600">You have no orders with local delivery.</p>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">Pending delivery</h2>
              <div className="overflow-x-auto">
                <table className="w-full border border-gray-200 rounded-lg overflow-hidden">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-2 px-3 text-sm font-medium">Order / Date</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Name</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Address</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Phone</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Note</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Items</th>
                      <th className="text-left py-2 px-3 text-sm font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((o) => {
                      const d = (o.localDeliveryDetails || {}) as LocalDeliveryDetails;
                      const addr = d.deliveryAddress;
                      const addressStr = addr
                        ? [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")
                        : "—";
                      return (
                        <tr key={o.id} className="border-t border-gray-200">
                          <td className="py-2 px-3 text-sm">
                            <span className="font-mono text-gray-600">{o.id.slice(-8)}</span>
                            <br />
                            <span className="text-gray-500">
                              {new Date(o.createdAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-sm">
                            {d.firstName} {d.lastName}
                          </td>
                          <td className="py-2 px-3 text-sm max-w-[180px]">{addressStr}</td>
                          <td className="py-2 px-3 text-sm">{d.phone ?? "—"}</td>
                          <td className="py-2 px-3 text-sm max-w-[120px]">{d.note ?? "—"}</td>
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
                              onClick={() => markDelivered(o.id)}
                              disabled={confirmingId === o.id}
                              className="btn text-sm py-1.5 px-3 disabled:opacity-50"
                            >
                              {confirmingId === o.id ? "Saving…" : "Order Delivered"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
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
                {showCompleted ? "Hide" : "Show"} completed deliveries ({completed.length})
              </button>
              {showCompleted && (
                <div className="overflow-x-auto">
                  <table className="w-full border border-gray-200 rounded-lg overflow-hidden">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left py-2 px-3 text-sm font-medium">Order / Date</th>
                        <th className="text-left py-2 px-3 text-sm font-medium">Name</th>
                        <th className="text-left py-2 px-3 text-sm font-medium">Address</th>
                        <th className="text-left py-2 px-3 text-sm font-medium">Phone</th>
                        <th className="text-left py-2 px-3 text-sm font-medium">Delivered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completed.map((o) => {
                        const d = (o.localDeliveryDetails || {}) as LocalDeliveryDetails;
                        const addr = d.deliveryAddress;
                        const addressStr = addr
                          ? [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")
                          : "—";
                        return (
                          <tr key={o.id} className="border-t border-gray-200">
                            <td className="py-2 px-3 text-sm">
                              <span className="font-mono text-gray-600">{o.id.slice(-8)}</span>
                              <br />
                              <span className="text-gray-500">
                                {new Date(o.createdAt).toLocaleDateString()}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-sm">
                              {d.firstName} {d.lastName}
                            </td>
                            <td className="py-2 px-3 text-sm max-w-[180px]">{addressStr}</td>
                            <td className="py-2 px-3 text-sm">{d.phone ?? "—"}</td>
                            <td className="py-2 px-3 text-sm text-gray-500">
                              {o.deliveryConfirmedAt
                                ? new Date(o.deliveryConfirmedAt).toLocaleDateString()
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
