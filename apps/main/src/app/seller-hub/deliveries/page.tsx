"use client";

import { useState, useEffect } from "react";
import { getErrorMessage } from "@/lib/api-error";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { BadgeEarnedStackOverlay, type EarnedBadgeForOverlay } from "@/components/BadgeEarnedStackOverlay";

interface LocalDeliveryDetails {
  firstName?: string;
  lastName?: string;
  phone?: string;
  deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  note?: string;
}

interface OrderWithDelivery {
  id: string;
  orderNumber?: string;
  status: string;
  createdAt: string;
  totalCents: number;
  stripePaymentIntentId?: string | null;
  localDeliveryDetails: LocalDeliveryDetails | null;
  deliveryConfirmedAt: string | null;
  deliveryBuyerConfirmedAt?: string | null;
  items: { storeItem: { title: string }; quantity: number; fulfillmentType?: string | null }[];
}

function sellerCanMarkLocalDelivery(o: OrderWithDelivery): boolean {
  if (o.deliveryConfirmedAt) return false;
  return ["paid", "shipped", "delivered"].includes(o.status);
}

function canSellerCancelDeliveryFromMenu(o: OrderWithDelivery): boolean {
  if (o.status !== "paid") return false;
  if (o.deliveryConfirmedAt) return false;
  if (!o.localDeliveryDetails) return false;
  return o.items.some((i) => (i.fulfillmentType ?? "") === "local_delivery");
}

export default function MyDeliveriesPage() {
  const [orders, setOrders] = useState<OrderWithDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadgeForOverlay[]>([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);
  const [deliveryMenuOpenId, setDeliveryMenuOpenId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  useLockBodyScroll(badgePopupIndex >= 0);

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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to update"));
        return;
      }
      const badges = Array.isArray(data.earnedBadges)
        ? (data.earnedBadges as EarnedBadgeForOverlay[]).filter((b) => b?.slug && b?.name)
        : [];
      if (badges.length > 0) {
        setEarnedBadges(badges);
        setBadgePopupIndex(0);
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

  async function cancelLocalDelivery(orderId: string) {
    const o = orders.find((x) => x.id === orderId);
    const paidOnline = Boolean(o?.stripePaymentIntentId);
    const ok = window.confirm(
      paidOnline
        ? "Cancel this delivery? The buyer will be refunded to their card and inventory will be restored."
        : "Cancel this cash delivery order? Inventory will be restored. Confirm with the buyer if they already paid you in person."
    );
    if (!ok) return;
    setDeliveryMenuOpenId(null);
    setCancelingId(orderId);
    setError("");
    try {
      const res = await fetch(`/api/store-orders/${orderId}/seller-cancel-local-delivery`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Could not cancel"));
        return;
      }
      setOrders((prev) => prev.filter((x) => x.id !== orderId));
    } finally {
      setCancelingId(null);
    }
  }

  const pending = orders.filter((o) => !(o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt));
  const completed = orders.filter((o) => o.deliveryConfirmedAt && o.deliveryBuyerConfirmedAt);

  const activeBadge =
    badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length ? earnedBadges[badgePopupIndex] : null;

  function handleCloseBadgePopup() {
    if (badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length - 1) {
      setBadgePopupIndex((i) => i + 1);
    } else {
      setEarnedBadges([]);
      setBadgePopupIndex(-1);
    }
  }

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
      <BadgeEarnedStackOverlay badge={activeBadge} onDismiss={handleCloseBadgePopup} />
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
                      <th className="text-left py-2 px-3 text-sm font-medium">Payment</th>
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
                            <span className="font-mono text-gray-600">#{o.orderNumber ?? o.id.slice(-8)}</span>
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
                              {o.stripePaymentIntentId ? "Paid: Online NWC" : "Awaiting Payment: Cash"}
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
                          <td className="py-2 px-3 max-w-[200px]">
                            <div className="flex flex-wrap items-start gap-2 justify-between">
                              <div className="min-w-0 flex-1">
                            {!o.deliveryConfirmedAt && sellerCanMarkLocalDelivery(o) ? (
                              <button
                                type="button"
                                onClick={() => markDelivered(o.id)}
                                disabled={confirmingId === o.id}
                                className="btn text-sm py-1.5 px-3 disabled:opacity-50"
                              >
                                {confirmingId === o.id ? "Saving…" : "Order Delivered"}
                              </button>
                            ) : !o.deliveryConfirmedAt ? (
                              <span className="text-xs text-amber-800">
                                {o.status === "pending"
                                  ? "Awaiting payment — mark delivered after the order is paid."
                                  : "Can’t mark delivered in this state."}
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled
                                className="text-sm py-1.5 px-3 rounded border border-gray-300 bg-gray-100 text-gray-700 font-medium cursor-default"
                              >
                                Marked Delivered
                              </button>
                            )}
                              </div>
                              {canSellerCancelDeliveryFromMenu(o) ? (
                                <div className="relative shrink-0">
                                  <button
                                    type="button"
                                    className="w-9 h-9 rounded border border-gray-300 text-lg leading-none text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    aria-label="Delivery options"
                                    disabled={cancelingId === o.id}
                                    onClick={() =>
                                      setDeliveryMenuOpenId((id) => (id === o.id ? null : o.id))
                                    }
                                  >
                                    ⋮
                                  </button>
                                  {deliveryMenuOpenId === o.id ? (
                                    <>
                                      <button
                                        type="button"
                                        className="fixed inset-0 z-40 cursor-default"
                                        aria-label="Close menu"
                                        onClick={() => setDeliveryMenuOpenId(null)}
                                      />
                                      <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-48 text-sm">
                                        <button
                                          type="button"
                                          className="block w-full text-left px-3 py-2 hover:bg-red-50 text-red-700 font-medium"
                                          onClick={() => void cancelLocalDelivery(o.id)}
                                        >
                                          Cancel delivery
                                        </button>
                                      </div>
                                    </>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
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
                              <span className="font-mono text-gray-600">#{o.orderNumber ?? o.id.slice(-8)}</span>
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
