"use client";

import { useState, useEffect } from "react";

interface OrderItem {
  storeItem: { title: string; id: string };
  quantity: number;
  priceCentsAtPurchase: number;
}

interface RefundedOrder {
  id: string;
  totalCents: number;
  status: string;
  refundReason: string | null;
  cancelReason: string | null;
  cancelNote: string | null;
  createdAt: string;
  updatedAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  seller: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
}

export default function AdminDisputesPage() {
  const [orders, setOrders] = useState<RefundedOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/refunded-orders")
      .then((r) => r.json())
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Refunded Orders / Disputes</h1>
      <p className="text-gray-600 mb-6">
        Monitor refunded orders. When a buyer has a dispute with a seller, the seller processes the refund here. Verify that items have been refunded and everyone is satisfied.
      </p>
      {orders.length === 0 ? (
        <p className="text-gray-500">No refunded orders.</p>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex flex-wrap justify-between gap-4 mb-2">
                <span className="font-mono text-sm text-gray-500">Order #{order.id.slice(-8)}</span>
                <span className="font-bold">${(order.totalCents / 100).toFixed(2)} refunded</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="font-medium text-gray-700">Buyer</p>
                  <p>
                    {order.buyer.firstName} {order.buyer.lastName}
                  </p>
                  <p className="text-gray-500">{order.buyer.email}</p>
                </div>
                <div>
                  <p className="font-medium text-gray-700">Seller</p>
                  <p>
                    {order.seller.firstName} {order.seller.lastName}
                  </p>
                  <p className="text-gray-500">{order.seller.email}</p>
                </div>
              </div>
              <div className="mt-2 text-sm">
                <p className="font-medium text-gray-700">Items</p>
                <ul className="list-disc list-inside mt-1">
                  {order.items.map((oi, i) => (
                    <li key={i}>
                      {oi.storeItem.title} × {oi.quantity} — ${(oi.priceCentsAtPurchase * oi.quantity / 100).toFixed(2)}
                    </li>
                  ))}
                </ul>
              </div>
              {(order.refundReason || order.cancelReason || order.cancelNote) && (
                <div className="mt-2 text-sm border-t pt-2">
                  <p className="font-medium text-gray-700">Reason</p>
                  <p className="text-gray-600">
                    {order.cancelReason || order.refundReason || "—"}
                    {order.cancelNote && ` — ${order.cancelNote}`}
                  </p>
                </div>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Refunded {new Date(order.updatedAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
