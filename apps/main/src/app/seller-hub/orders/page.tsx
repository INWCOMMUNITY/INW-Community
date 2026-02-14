"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { formatShippingAddress } from "@/lib/format-address";

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

interface SellerProfile {
  business: { name: string; phone: string | null; address: string | null; logoUrl: string | null } | null;
  packingSlipNote?: string | null;
}

export default function SellerOrdersPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [addingTrial, setAddingTrial] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setFetchError(null);
    fetch("/api/store-orders?mine=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg =
            r.status === 401
              ? "Please sign in to view orders."
              : r.status === 403
              ? (data as { error?: string }).error ?? "Seller plan required."
              : (data as { error?: string }).error ?? "Failed to load orders.";
          setFetchError(msg);
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then(setOrders)
      .catch(() => {
        setFetchError("Connection failed. Make sure the server and PostgreSQL are running.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (orders.length > 0) {
      fetch("/api/seller-profile")
        .then((r) => r.json())
        .then((p: SellerProfile) => setSellerProfile(p))
        .catch(() => setSellerProfile(null));
    } else {
      setSellerProfile(null);
    }
  }, [orders.length]);

  async function addTrialOrder() {
    setAddingTrial(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/store-orders/trial", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFetchError((data as { error?: string }).error ?? "Failed to add trial order.");
        return;
      }
      setOrders((prev) => [data as StoreOrder, ...prev]);
    } catch {
      setFetchError("Failed to add trial order.");
    } finally {
      setAddingTrial(false);
    }
  }

  async function markShipped(orderId: string) {
    setUpdating(orderId);
    try {
      const res = await fetch(`/api/store-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "shipped" }),
      });
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: "shipped" } : o))
        );
      }
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <p className="text-gray-500">Loading…</p>
        </div>
      </section>
    );
  }

  const ordersToPrint = orders.filter((o) => o.status === "paid" || o.status === "shipped");

  return (
    <>
    <section className="py-12 px-4 no-print" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/seller-hub" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Seller Hub
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Orders</h1>
            <p className="text-gray-600 mt-1">
              View and manage orders from your storefront. Mark orders as shipped when you send them.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addTrialOrder}
              disabled={addingTrial}
              className="btn bg-gray-600 hover:bg-gray-700 text-white"
            >
              {addingTrial ? "Adding…" : "Add trial order"}
            </button>
            {ordersToPrint.length > 0 && sellerProfile && (
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn"
                >
                  Print Packing Slips
                </button>
                <p className="text-xs text-gray-500 mt-2 no-print">
                  Tip: In the print dialog, turn off &quot;Headers and footers&quot; to hide the page URL and page number on the printed slip.
                </p>
              </>
            )}
          </div>
        </div>

        {fetchError && (
          <div className="border rounded-lg p-6 bg-red-50 mb-8">
            <p className="text-red-700">{fetchError}</p>
            {fetchError.includes("sign in") && (
              <Link href="/login?callbackUrl=/seller-hub/orders" className="btn mt-4 inline-block">
                Sign in
              </Link>
            )}
          </div>
        )}

        {orders.length === 0 && !fetchError ? (
          <p className="text-gray-500">No orders yet.</p>
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
                {order.shippingAddress != null && typeof order.shippingAddress === "object" ? (
                  <div className="text-sm text-gray-600 mb-4">
                    <p className="font-medium">Shipping address</p>
                    <p className="mt-1 font-sans whitespace-pre-wrap">
                      {formatShippingAddress(order.shippingAddress)}
                    </p>
                  </div>
                ) : null}
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
                {order.status === "paid" && (
                  <button
                    type="button"
                    onClick={() => markShipped(order.id)}
                    disabled={updating === order.id}
                    className="btn mt-4"
                  >
                    {updating === order.id ? "Updating…" : "Mark as shipped"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
    <PackingSlipPrint orders={ordersToPrint} sellerProfile={sellerProfile} />
    </>
  );
}
