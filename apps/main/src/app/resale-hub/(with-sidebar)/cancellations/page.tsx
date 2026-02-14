"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: { id: string; title: string; slug: string; photos: string[]; listingType?: string };
}

interface StoreOrder {
  id: string;
  totalCents: number;
  status: string;
  createdAt: string;
  inventoryRestoredAt: string | null;
  stripePaymentIntentId: string | null;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
}

export default function ResaleHubCancellationsPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [relisting, setRelisting] = useState<string | null>(null);
  const [relistError, setRelistError] = useState<string | null>(null);

  useEffect(() => {
    setFetchError(null);
    fetch("/api/store-orders?mine=1&canceled=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg =
            r.status === 401
              ? "Please sign in to view cancellations."
              : r.status === 403
              ? (data as { error?: string }).error ?? "Seller plan required."
              : (data as { error?: string }).error ?? "Failed to load cancellations.";
          setFetchError(msg);
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then(setOrders)
      .catch(() => {
        setFetchError("Connection failed.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  async function relistOrder(orderId: string) {
    setRelisting(orderId);
    setRelistError(null);
    try {
      const res = await fetch(`/api/store-orders/${orderId}/relist`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, inventoryRestoredAt: new Date().toISOString() } : o
          )
        );
      } else {
        setRelistError((data as { error?: string }).error ?? "Re-list failed");
      }
    } catch {
      setRelistError("Re-list failed");
    } finally {
      setRelisting(null);
    }
  }

  const cashOrders = orders.filter((o) => !o.stripePaymentIntentId);
  const pendingRelist = cashOrders.filter((o) => !o.inventoryRestoredAt);
  const alreadyRelisted = cashOrders.filter((o) => o.inventoryRestoredAt);

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Cancellations</h2>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Cancellations</h2>
      <p className="text-gray-600 mb-6">
        When a buyer cancels a cash order, inventory is not restored automatically. Review canceled
        orders here and re-list items when you are ready so they become available for sale again.
      </p>

      {fetchError && (
        <div className="border rounded-lg p-6 bg-red-50 mb-8">
          <p className="text-red-700">{fetchError}</p>
          {fetchError.includes("sign in") && (
            <Link href="/login?callbackUrl=/resale-hub/cancellations" className="btn mt-4 inline-block">
              Sign in
            </Link>
          )}
        </div>
      )}

      {relistError && (
        <div className="border rounded-lg p-4 bg-red-50 mb-6">
          <p className="text-red-700">{relistError}</p>
        </div>
      )}

      {orders.length === 0 && !fetchError ? (
        <p className="text-gray-500">No canceled orders.</p>
      ) : (
        <div className="space-y-6">
          {pendingRelist.length > 0 && (
            <>
              <h3 className="text-lg font-semibold" style={{ color: "var(--color-heading)" }}>
                Awaiting re-list
              </h3>
              {pendingRelist.map((order) => (
                <div key={order.id} className="border-2 rounded-lg p-6" style={{ borderColor: "var(--color-primary)" }}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="font-semibold">
                        {order.buyer.firstName} {order.buyer.lastName}
                      </p>
                      <p className="text-sm text-gray-600">{order.buyer.email}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Canceled {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">${(order.totalCents / 100).toFixed(2)}</p>
                      <span className="inline-block px-2 py-0.5 rounded text-sm bg-amber-100 text-amber-800 mt-1">
                        Cash order — re-list to restore inventory
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
                    onClick={() => relistOrder(order.id)}
                    disabled={relisting === order.id}
                    className="btn"
                    style={{ backgroundColor: "var(--color-primary)", color: "white" }}
                  >
                    {relisting === order.id ? "Re-listing…" : "Re-list items"}
                  </button>
                </div>
              ))}
            </>
          )}

          {alreadyRelisted.length > 0 && (
            <>
              <h3 className="text-lg font-semibold mt-8" style={{ color: "var(--color-heading)" }}>
                Already re-listed
              </h3>
              {alreadyRelisted.map((order) => (
                <div key={order.id} className="border rounded-lg p-6 bg-gray-50">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="font-semibold">
                        {order.buyer.firstName} {order.buyer.lastName}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        Re-listed {order.inventoryRestoredAt && new Date(order.inventoryRestoredAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">${(order.totalCents / 100).toFixed(2)}</p>
                    </div>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {order.items.map((oi) => (
                      <li key={oi.id}>
                        {oi.storeItem.title} × {oi.quantity}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {cashOrders.length === 0 && orders.length > 0 && (
            <p className="text-gray-500">
              You have no canceled cash orders. (Canceled card orders are refunded and inventory is restored automatically.)
            </p>
          )}
        </div>
      )}

      <Link href="/resale-hub/listings" className="inline-block mt-6 hover:underline" style={{ color: "var(--color-link)" }}>
        View My Listings →
      </Link>
    </div>
  );
}
