"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreOrder {
  id: string;
  totalCents: number;
  shippingCostCents: number;
  status: string;
  shippingAddress: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
}

export default function RequestedReturnsPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);

  useEffect(() => {
    setFetchError(null);
    fetch("/api/store-orders?mine=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg =
            r.status === 401
              ? "Please sign in to view returns."
              : r.status === 403
              ? (data as { error?: string }).error ?? "Seller plan required."
              : (data as { error?: string }).error ?? "Failed to load orders.";
          setFetchError(msg);
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then((data: StoreOrder[]) =>
        setOrders(data.filter((o) => o.status === "paid" || o.status === "shipped"))
      )
      .catch(() => {
        setFetchError("Connection failed.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  async function issueRefund(orderId: string) {
    setRefunding(orderId);
    setRefundError(null);
    try {
      const res = await fetch(`/api/store-orders/${orderId}/refund`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else {
        setRefundError(data.message ?? data.error ?? "Refund failed");
      }
    } catch {
      setRefundError("Refund failed");
    } finally {
      setRefunding(null);
    }
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Requested Returns</h2>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Requested Returns</h2>
      <p className="text-gray-600 mb-6">
        Issue refunds for orders. Refunds are deducted from your My Funds balance. If your balance
        is insufficient, add a payment method in your Stripe Connect settings.
      </p>

      {fetchError && (
        <div className="border rounded-lg p-6 bg-red-50 mb-8">
          <p className="text-red-700">{fetchError}</p>
          {fetchError.includes("sign in") && (
            <Link href="/login?callbackUrl=/seller-hub/store/returns" className="btn mt-4 inline-block">
              Sign in
            </Link>
          )}
        </div>
      )}

      {refundError && (
        <div className="border rounded-lg p-4 bg-red-50 mb-6">
          <p className="text-red-700">{refundError}</p>
        </div>
      )}

      {orders.length === 0 && !fetchError ? (
        <p className="text-gray-500">No orders eligible for refund at this time.</p>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => (
            <div key={order.id} className="border rounded-lg p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
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
                    {order.status}
                  </span>
                </div>
              </div>
              <div className="border-t pt-4 mb-4">
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
              <button
                type="button"
                onClick={() => issueRefund(order.id)}
                disabled={refunding === order.id}
                className="btn bg-red-600 hover:bg-red-700 text-white hover:text-white"
              >
                {refunding === order.id ? "Processing…" : "Issue refund"}
              </button>
            </div>
          ))}
        </div>
      )}

      <Link href="/seller-hub/store/payouts" className="inline-block mt-6 text-primary-600 hover:underline">
        View My Funds →
      </Link>
    </div>
  );
}
