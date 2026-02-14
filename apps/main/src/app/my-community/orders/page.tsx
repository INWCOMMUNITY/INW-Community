"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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
  totalCents: number;
  shippingCostCents: number;
  status: string;
  shippingAddress: unknown;
  createdAt: string;
  refundRequestedAt: string | null;
  refundReason: string | null;
  isCashOrder?: boolean;
  seller: {
    firstName: string;
    lastName: string;
    businesses: { name: string; slug: string }[];
  };
  items: OrderItem[];
  shipment: Shipment | null;
}

function getTrackingUrl(carrier: string, trackingNumber: string): string {
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  return `https://www.google.com/search?q=track+${trackingNumber}`;
}

export default function MyOrdersPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [requestingRefund, setRequestingRefund] = useState<string | null>(null);
  const [cancelingOrder, setCancelingOrder] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [refundModal, setRefundModal] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundOtherReason, setRefundOtherReason] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOtherReason, setCancelOtherReason] = useState("");
  const [cancelNote, setCancelNote] = useState("");

  const CANCEL_REASONS = [
    "Changed my mind",
    "Didn't mean to order",
    "Order Arrived Damaged",
    "Wrong Item Delivered",
    "Other",
  ] as const;

  useEffect(() => {
    setFetchError(null);
    fetch("/api/store-orders?buyer=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setFetchError((data as { error?: string }).error ?? "Failed to load orders.");
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then(setOrders)
      .catch(() => {
        setFetchError("Connection failed. Make sure the server is running.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  async function requestRefund(orderId: string) {
    if (!refundReason) {
      alert("Please select a reason for your refund request.");
      return;
    }
    if (refundReason === "Other" && !refundOtherReason.trim()) {
      alert("Please provide details for \"Other\".");
      return;
    }
    setRequestingRefund(orderId);
    try {
      const res = await fetch(`/api/store-orders/${orderId}/request-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: refundReason || undefined,
          otherReason: refundReason === "Other" ? refundOtherReason : undefined,
          note: refundNote || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const displayReason = refundReason === "Other" && refundOtherReason
          ? `Other: ${refundOtherReason}`
          : refundReason;
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, refundRequestedAt: new Date().toISOString(), refundReason: displayReason || null } : o
          )
        );
        setRefundModal(null);
        setRefundReason("");
        setRefundOtherReason("");
        setRefundNote("");
      } else {
        alert((data as { error?: string }).error ?? "Failed to request refund.");
      }
    } catch {
      alert("Failed to request refund.");
    } finally {
      setRequestingRefund(null);
    }
  }

  async function cancelOrder(orderId: string) {
    if (!cancelReason) {
      alert("Please select a reason for cancellation.");
      return;
    }
    if (cancelReason === "Other" && !cancelOtherReason.trim()) {
      alert("Please provide details for \"Other\".");
      return;
    }
    setCancelingOrder(orderId);
    try {
      const res = await fetch(`/api/store-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: cancelReason,
          otherReason: cancelReason === "Other" ? cancelOtherReason : undefined,
          note: cancelNote || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? { ...o, status: (data as { refunded?: boolean }).refunded ? "refunded" : "canceled" }
              : o
          )
        );
        setCancelConfirm(null);
        setCancelReason("");
        setCancelOtherReason("");
        setCancelNote("");
      } else {
        alert((data as { error?: string }).error ?? "Failed to cancel order.");
      }
    } catch {
      alert("Failed to cancel order.");
    } finally {
      setCancelingOrder(null);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Orders</h1>
      <p className="text-gray-600 mb-6">
        View your purchases, track shipments, and request refunds.
      </p>

      {fetchError && (
        <div className="border rounded-lg p-6 bg-red-50 mb-8">
          <p className="text-red-700">{fetchError}</p>
          {fetchError.includes("sign in") && (
            <Link href="/login?callbackUrl=/my-community/orders" className="btn mt-4 inline-block">
              Sign in
            </Link>
          )}
        </div>
      )}

      {orders.length === 0 && !fetchError ? (
        <p className="text-gray-500">No orders yet.</p>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const sellerName =
              order.seller.businesses?.[0]?.name ??
              `${order.seller.firstName} ${order.seller.lastName}`;
            const canCancel = order.status === "paid";
            const canRequestRefund =
              (order.status === "paid" || order.status === "shipped") &&
              !order.refundRequestedAt &&
              !order.isCashOrder;

            return (
              <div key={order.id} className="border-2 border-[var(--color-primary)] rounded-lg p-6 relative">
                <div className="absolute top-4 right-4">
                  {(canCancel || canRequestRefund) && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenuOpen(menuOpen === order.id ? null : order.id)}
                        className="p-1.5 rounded hover:opacity-80 transition-opacity"
                        style={{ color: "var(--color-heading)" }}
                        aria-label="Order options"
                        aria-expanded={menuOpen === order.id}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                          <circle cx="12" cy="6" r="1.5" />
                          <circle cx="12" cy="12" r="1.5" />
                          <circle cx="12" cy="18" r="1.5" />
                        </svg>
                      </button>
                      {menuOpen === order.id && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setMenuOpen(null)}
                            aria-hidden
                          />
                          <div
                            className="absolute right-0 top-full mt-1 py-1 rounded border-2 z-50 min-w-[160px]"
                            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)" }}
                          >
                            {canCancel && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpen(null);
                                  setCancelConfirm(order.id);
                                  setCancelReason("");
                                  setCancelOtherReason("");
                                  setCancelNote("");
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-[var(--color-primary)] hover:opacity-100 hover:bg-[var(--color-primary)] hover:text-white"
                              >
                                Cancel order
                              </button>
                            )}
                            {canRequestRefund && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpen(null);
                                  setRefundModal(order.id);
                                  setRefundReason("");
                                  setRefundOtherReason("");
                                  setRefundNote("");
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-[var(--color-primary)] hover:opacity-100 hover:bg-[var(--color-primary)] hover:text-white"
                              >
                                Request refund
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex justify-between items-start mb-4 pr-10">
                  <div>
                    <p className="font-semibold">Order #{order.id.slice(-8).toUpperCase()}</p>
                    <p className="text-sm opacity-80">{sellerName}</p>
                    <p className="text-sm opacity-70 mt-1">
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">${(order.totalCents / 100).toFixed(2)}</p>
                    <span
                      className="inline-block px-2 py-0.5 rounded text-sm mt-1"
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

                {order.refundRequestedAt && (
                    <p className="text-sm mb-4 opacity-80" style={{ color: "var(--color-primary)" }}>
                    Refund requested on {new Date(order.refundRequestedAt).toLocaleDateString()}. The
                    seller will review.
                    {order.refundReason && (
                      <span className="block mt-1 opacity-90">Reason: {order.refundReason}</span>
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {cancelConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!cancelingOrder) setCancelConfirm(null);
            }}
            aria-hidden
          />
          <div
            className="relative rounded-lg p-6 w-full max-w-md border-2 max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)" }}
          >
            <h3 className="text-lg font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Cancel order
            </h3>
            <p className="text-sm mb-4 opacity-80">
              {orders.find((o) => o.id === cancelConfirm)?.isCashOrder
                ? "This order was paid in cash. Canceling will release the items back to the seller. No refund is involved."
                : "This will cancel your order and refund the amount to your original payment method. The refund is processed from the seller\u2019s funds."}
            </p>
            <p className="text-sm font-medium mb-2">Reason for cancellation (required)</p>
            <select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full border-2 rounded px-3 py-2 mb-4"
              style={{ borderColor: "var(--color-primary)" }}
              disabled={!!cancelingOrder}
            >
              <option value="">Select a reason…</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {cancelReason === "Other" && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-1">Please specify</p>
                <textarea
                  value={cancelOtherReason}
                  onChange={(e) => setCancelOtherReason(e.target.value)}
                  placeholder="Describe your reason..."
                  rows={2}
                  className="w-full border-2 rounded px-3 py-2 resize-none"
                  style={{ borderColor: "var(--color-primary)" }}
                  disabled={!!cancelingOrder}
                />
              </div>
            )}
            <div className="mb-4">
              <p className="text-sm font-medium mb-1">Note for seller (optional)</p>
              <textarea
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder="Add a note for the seller..."
                rows={2}
                className="w-full border-2 rounded px-3 py-2 resize-none"
                style={{ borderColor: "var(--color-primary)" }}
                disabled={!!cancelingOrder}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!cancelingOrder) setCancelConfirm(null);
                }}
                className="px-4 py-2 rounded border-2"
                style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                disabled={!!cancelingOrder}
              >
                Keep order
              </button>
              <button
                type="button"
                onClick={() => cancelConfirm && cancelOrder(cancelConfirm)}
                disabled={!!cancelingOrder}
                className="btn text-white hover:text-white"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                {cancelingOrder === cancelConfirm ? "Processing…" : "Cancel order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {refundModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!requestingRefund) {
                setRefundModal(null);
                setRefundReason("");
                setRefundOtherReason("");
                setRefundNote("");
              }
            }}
            aria-hidden
          />
          <div
            className="relative rounded-lg p-6 w-full max-w-md border-2 max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)" }}
          >
            <h3 className="text-lg font-bold mb-3" style={{ color: "var(--color-heading)" }}>
              Request refund
            </h3>
            <p className="text-sm mb-4 opacity-80">
              The seller will review your request. Please provide a reason.
            </p>
            <p className="text-sm font-medium mb-2">Reason (required)</p>
            <select
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              className="w-full border-2 rounded px-3 py-2 mb-4"
              style={{ borderColor: "var(--color-primary)" }}
              disabled={!!requestingRefund}
            >
              <option value="">Select a reason…</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {refundReason === "Other" && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-1">Please specify</p>
                <textarea
                  value={refundOtherReason}
                  onChange={(e) => setRefundOtherReason(e.target.value)}
                  placeholder="Describe your reason..."
                  rows={2}
                  className="w-full border-2 rounded px-3 py-2 resize-none"
                  style={{ borderColor: "var(--color-primary)" }}
                  disabled={!!requestingRefund}
                />
              </div>
            )}
            <div className="mb-4">
              <p className="text-sm font-medium mb-1">Note for seller (optional)</p>
              <textarea
                value={refundNote}
                onChange={(e) => setRefundNote(e.target.value)}
                placeholder="Add a note for the seller..."
                rows={2}
                className="w-full border-2 rounded px-3 py-2 resize-none"
                style={{ borderColor: "var(--color-primary)" }}
                disabled={!!requestingRefund}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!requestingRefund) {
                    setRefundModal(null);
                    setRefundReason("");
                    setRefundOtherReason("");
                    setRefundNote("");
                  }
                }}
                className="px-4 py-2 rounded border-2"
                style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                disabled={!!requestingRefund}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => refundModal && requestRefund(refundModal)}
                disabled={!!requestingRefund}
                className="btn text-white hover:text-white"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                {requestingRefund === refundModal ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
