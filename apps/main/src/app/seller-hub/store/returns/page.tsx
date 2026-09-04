"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { returnRefundAmountCents, storeReturnBuyerLabel } from "@/lib/store-return";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  fulfillmentType?: string | null;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreReturn {
  id: string;
  status: string;
  reason?: string | null;
  note?: string | null;
  chargeReturnShipping: boolean;
  returnLabelCostCents: number;
  declineReason?: string | null;
}

interface StoreOrder {
  id: string;
  totalCents: number;
  taxCents?: number;
  shippingCostCents: number;
  status: string;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  storeReturn?: StoreReturn | null;
  returnShipment?: { labelUrl?: string | null; labelCostCents?: number; trackingNumber?: string | null } | null;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RequestedReturnsPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");

  function load() {
    setFetchError(null);
    fetch("/api/store-orders?mine=1&returns=1")
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
      .then((data: StoreOrder[]) => setOrders(data))
      .catch(() => {
        setFetchError("Connection failed.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function postAction(orderId: string, path: string, body?: object) {
    setBusyId(orderId);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/store-orders/${orderId}${path}`, {
        method: "POST",
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError((data as { error?: string }).error ?? "Action failed");
        return;
      }
      setActionSuccess("Updated.");
      load();
    } catch {
      setActionError("Connection failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Return Requests</h2>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Return Requests</h2>
      <p className="text-gray-600 mb-6">
        Approve a return, send a Shippo return label, then refund after you receive the item. Courtesy
        refunds send money back now and the buyer keeps the item. Refunds come from My Funds.
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

      {actionSuccess && (
        <div className="border rounded-lg p-4 bg-green-50 mb-6">
          <p className="text-green-800">{actionSuccess}</p>
        </div>
      )}
      {actionError && (
        <div className="border rounded-lg p-4 bg-red-50 mb-6">
          <p className="text-red-700">{actionError}</p>
        </div>
      )}

      {orders.length === 0 && !fetchError ? (
        <p className="text-gray-500">No open return requests.</p>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const ret = order.storeReturn;
            const labelCost = order.returnShipment?.labelCostCents ?? ret?.returnLabelCostCents ?? 0;
            const proposed = returnRefundAmountCents({
              totalCents: order.totalCents,
              taxCents: order.taxCents,
              chargeReturnShipping: ret?.chargeReturnShipping === true,
              returnLabelCostCents: labelCost,
            });
            const busy = busyId === order.id;
            return (
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
                    <p className="text-sm mt-2" style={{ color: "var(--color-primary)" }}>
                      {storeReturnBuyerLabel(ret?.status) ?? ret?.status}
                    </p>
                    {ret?.reason ? <p className="text-sm text-gray-700 mt-1">Reason: {ret.reason}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{formatPrice(order.totalCents + (order.taxCents ?? 0))}</p>
                    <p className="text-sm text-gray-600">Refund: {formatPrice(proposed)}</p>
                    {ret?.chargeReturnShipping && labelCost > 0 ? (
                      <p className="text-xs text-gray-500">Minus return label {formatPrice(labelCost)}</p>
                    ) : null}
                  </div>
                </div>
                <ul className="space-y-2 mb-4">
                  {order.items.map((oi) => (
                    <li key={oi.id} className="flex items-center gap-2 text-sm">
                      {oi.storeItem.photos[0] ? (
                        <img src={oi.storeItem.photos[0]} alt="" className="w-10 h-10 object-cover rounded" />
                      ) : null}
                      <span>
                        {oi.storeItem.title} × {oi.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {ret?.status === "requested" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className="btn text-sm py-2 px-3"
                        onClick={() => postAction(order.id, "/returns/approve")}
                      >
                        {busy ? "Working…" : "Approve return"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="btn text-sm py-2 px-3 bg-red-600 hover:bg-red-700 text-white"
                        onClick={() => {
                          setDeclineFor(order.id);
                          setDeclineReason("");
                        }}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="text-sm py-2 px-3 border rounded-lg"
                        onClick={() => postAction(order.id, "/refund", { requireReturn: false })}
                      >
                        Courtesy refund (keep item)
                      </button>
                    </>
                  ) : null}
                  {ret?.status === "awaiting_return" || ret?.status === "in_transit" ? (
                    <>
                      {order.items.some((i) => (i.fulfillmentType ?? "ship") === "ship") && !order.returnShipment?.labelUrl ? (
                        <Link
                          href={`/seller-hub/orders/shippo/${order.id}?labelAction=return`}
                          className="btn text-sm py-2 px-3 inline-block"
                        >
                          Buy return label
                        </Link>
                      ) : null}
                      {order.returnShipment?.labelUrl ? (
                        <a
                          href={order.returnShipment.labelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm py-2 px-3 border rounded-lg"
                        >
                          Open return label PDF
                        </a>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        className="btn text-sm py-2 px-3"
                        onClick={() => postAction(order.id, "/returns/receive")}
                      >
                        {busy ? "Refunding…" : "Mark received & refund"}
                      </button>
                    </>
                  ) : null}
                </div>
                {declineFor === order.id ? (
                  <div className="mt-4 space-y-2">
                    <textarea
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      rows={3}
                      placeholder="Tell the buyer why"
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                    />
                    <button
                      type="button"
                      disabled={busy || !declineReason.trim()}
                      className="btn text-sm py-2 px-3"
                      onClick={() => {
                        postAction(order.id, "/returns/decline", { reason: declineReason.trim() });
                        setDeclineFor(null);
                      }}
                    >
                      Send decline
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Link href="/seller-hub/store/payouts" className="inline-block mt-6 text-primary-600 hover:underline">
        View My Funds →
      </Link>
    </div>
  );
}
