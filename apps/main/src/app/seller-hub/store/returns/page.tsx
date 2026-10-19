"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCartVariantLabel } from "@/lib/cart-line-identity";
import { orderCanBuyReturnLabel, returnRefundAmountCents, storeReturnBuyerLabel, storeReturnSellerMoneyAction, storeReturnSellerMoneyActionLabel } from "@/lib/store-return";
import { returnLabelIsDue, sellerMustChooseReturnRefundTiming } from "@/lib/return-refund-timing";
import { getTrackingUrl } from "@/lib/store-order-fulfillment";
import { ReturnLabelDueTag, SellerReturnRefundChoiceModal } from "@/components/seller/SellerReturnRefundChoice";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  fulfillmentType?: string | null;
  variant?: unknown;
  stockReturnDecision?: string | null;
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
  cancelReason?: string | null;
  inventoryRestoredAt?: string | null;
  createdAt: string;
  localDeliveryDetails?: unknown;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  storeReturn?: StoreReturn | null;
  returnShipment?: {
    labelUrl?: string | null;
    labelCostCents?: number;
    trackingNumber?: string | null;
    carrier?: string | null;
  } | null;
}

const SOLD_BEFORE_CHECKOUT_REASON = "Item sold before checkout was complete";

function isFinishedReturn(order: StoreOrder): boolean {
  const status = order.storeReturn?.status;
  return status === "refunded" || status === "declined" || status === "canceled";
}

function isCanceledOrder(order: StoreOrder): boolean {
  if (order.cancelReason === SOLD_BEFORE_CHECKOUT_REASON) return false;
  if (order.storeReturn && !isFinishedReturn(order)) return false;
  return (
    isFinishedReturn(order) ||
    order.status === "canceled" ||
    order.status === "cancelled" ||
    order.status === "refunded"
  );
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function stockChoiceLabel(item: OrderItem): string {
  const variant = formatCartVariantLabel(item.variant);
  const name = variant ? `${item.storeItem.title} — ${variant}` : item.storeItem.title;
  return `Return Stock Count for ${name}?`;
}

function formatReturnTracking(trackingNumber: string): string {
  const digits = trackingNumber.replace(/\D/g, "");
  if (digits.length === 22) return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
  return trackingNumber.trim();
}

function stockChoiceResult(order: StoreOrder, item: OrderItem): string | null {
  if (item.stockReturnDecision === "returned" || (order.inventoryRestoredAt && !item.stockReturnDecision)) {
    return "Stock returned";
  }
  if (item.stockReturnDecision === "withheld") return "Stock not returned";
  return null;
}

export default function RequestedReturnsPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [sendLabelOrder, setSendLabelOrder] = useState<StoreOrder | null>(null);
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [confirmReceiveId, setConfirmReceiveId] = useState<string | null>(null);

  const openReturnLabel = useCallback(
    (orderId: string) => {
      setSendLabelOrder(null);
      router.push(`/seller-hub/orders/shippo/${orderId}?labelAction=return`);
    },
    [router]
  );

  useEffect(() => {
    if (!sendLabelOrder) return;
    if (sendLabelOrder.storeReturn?.chargeReturnShipping && !sendLabelOrder.returnShipment?.labelUrl) return;
    const orderId = sendLabelOrder.id;
    const t = window.setTimeout(() => {
      openReturnLabel(orderId);
    }, 400);
    return () => window.clearTimeout(t);
  }, [sendLabelOrder, openReturnLabel]);

  async function chooseLabelPayer(orderId: string, pay: "seller" | "buyer") {
    setBusyId(orderId);
    setActionError(null);
    try {
      const res = await fetch(`/api/store-orders/${orderId}/returns/label-payer`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pay }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError((data as { error?: string }).error ?? "Could not save who pays for this label.");
        setSendLabelOrder(null);
        return;
      }
      openReturnLabel(orderId);
    } catch {
      setActionError("Connection failed.");
      setSendLabelOrder(null);
    } finally {
      setBusyId(null);
    }
  }

  async function chooseRefundTiming(orderId: string, timing: "now" | "on_arrival") {
    setChoiceBusy(true);
    setChoiceError(null);
    try {
      if (timing === "now") {
        const res = await fetch(`/api/store-orders/${orderId}/returns/receive`, {
          method: "POST",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setChoiceError((data as { error?: string }).error ?? "Could not refund this order.");
          return;
        }
      } else {
        const res = await fetch(`/api/store-orders/${orderId}/returns/refund-timing`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timing: "on_arrival" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setChoiceError((data as { error?: string }).error ?? "Could not save that choice.");
          return;
        }
      }
      load();
    } catch {
      setChoiceError("Connection failed.");
    } finally {
      setChoiceBusy(false);
    }
  }

  function load() {
    setFetchError(null);
    Promise.all([
      fetch("/api/store-orders?mine=1&returns=1"),
      fetch("/api/store-orders?mine=1&canceled=1"),
    ])
      .then(async ([returnsRes, canceledRes]) => {
        const returnsData = await returnsRes.json().catch(() => ({}));
        if (!returnsRes.ok) {
          const msg =
            returnsRes.status === 401
              ? "Please sign in to view returns."
              : returnsRes.status === 403
                ? (returnsData as { error?: string }).error ?? "Seller plan required."
                : (returnsData as { error?: string }).error ?? "Failed to load orders.";
          setFetchError(msg);
          return [];
        }
        const openReturns: StoreOrder[] = Array.isArray(returnsData) ? returnsData : [];
        const canceledData = canceledRes.ok ? await canceledRes.json().catch(() => []) : [];
        const seen = new Set(openReturns.map((order) => order.id));
        const canceledOrders = (Array.isArray(canceledData) ? (canceledData as StoreOrder[]) : []).filter(
          (order) => !seen.has(order.id) && isCanceledOrder(order)
        );
        return [...openReturns, ...canceledOrders];
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("labelSent") !== "1") return;
    setActionSuccess("Return label sent");
    window.history.replaceState({}, "", "/seller-hub/store/returns");
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
        load();
        return;
      }
      const approvedOrder = orders.find((o) => o.id === orderId);
      if (path === "/returns/approve" && approvedOrder && orderCanBuyReturnLabel(approvedOrder)) {
        setSendLabelOrder(approvedOrder);
        load();
        return;
      }
      setActionSuccess("Updated.");
      load();
    } catch {
      setActionError("Connection failed.");
      load();
    } finally {
      setBusyId(null);
    }
  }

  const choiceOrder = orders.find((order) => sellerMustChooseReturnRefundTiming(order)) ?? null;

  if (loading) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-4">Refunds & Cancellations</h2>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Refunds & Cancellations</h2>
      <p className="text-gray-600 mb-6">
        Refund requests arrive here after an item ships. Approve or decline each one. Canceled orders
        are listed here too. Under those items, choose Return only when you have that variant back.
        Don&apos;t Return leaves the count off the listing. After you approve a mailed return, send a Shippo
        return label, then refund when the item comes back. Courtesy refunds send money now and the
        buyer keeps the item. Refunds come from My Funds.
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
        <p className="text-gray-500">No refunds yet.</p>
      ) : (
        <div className="space-y-6">
          {orders.map((order) => {
            const ret = order.storeReturn;
            const labelCost = order.returnShipment?.labelCostCents ?? ret?.returnLabelCostCents ?? 0;
            const proposed = returnRefundAmountCents({
              totalCents: order.totalCents,
              taxCents: order.taxCents,
              chargeReturnShipping: Boolean(ret?.chargeReturnShipping),
              returnLabelCostCents: labelCost,
            });
            const moneyAction = storeReturnSellerMoneyAction({
              returnStatus: ret?.status,
              orderStatus: order.status,
            });
            const busy = busyId === order.id;
            const pendingRefund = ret?.status === "requested";
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
                      {ret
                        ? ret.status === "refunded"
                          ? "Refunded"
                          : ret.status === "declined"
                          ? "Declined"
                          : ret.status === "canceled"
                          ? "Return canceled"
                          : order.returnShipment?.labelUrl &&
                            (ret.status === "awaiting_return" || ret.status === "in_transit")
                          ? "Return label sent."
                          : ret.status === "awaiting_return" && !order.returnShipment?.labelUrl
                          ? "Return approved. Send the buyer a return label."
                          : (storeReturnBuyerLabel(ret.status, {
                              hasReturnLabel: Boolean(order.returnShipment?.labelUrl),
                            }) ?? ret.status)
                        : "Canceled"}
                    </p>
                    {order.returnShipment?.trackingNumber ? (
                      <a
                        href={getTrackingUrl(
                          order.returnShipment.carrier || "USPS",
                          order.returnShipment.trackingNumber.replace(/\s/g, "")
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm mt-1 inline-block font-medium hover:underline"
                        style={{ color: "var(--color-link)" }}
                      >
                        Return tracking {formatReturnTracking(order.returnShipment.trackingNumber)}
                      </a>
                    ) : null}
                    {ret?.reason ? <p className="text-sm text-gray-700 mt-1">Reason: {ret.reason}</p> : null}
                    {!ret && order.cancelReason ? (
                      <p className="text-sm text-gray-700 mt-1">{order.cancelReason}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="font-bold">{formatPrice(order.totalCents + (order.taxCents ?? 0))}</p>
                    {ret ? <p className="text-sm text-gray-600">Refund: {formatPrice(proposed)}</p> : null}
                    {ret?.chargeReturnShipping && labelCost > 0 ? (
                      <p className="text-xs text-gray-500">Minus return label {formatPrice(labelCost)}</p>
                    ) : null}
                  </div>
                </div>
                <div className="mb-4">
                  {order.items.map((oi) => {
                    const decided = stockChoiceResult(order, oi);
                    return (
                      <div key={oi.id}>
                        <div className="flex items-start gap-2 text-sm mt-3">
                          {oi.storeItem.photos[0] ? (
                            <img src={oi.storeItem.photos[0]} alt="" className="w-10 h-10 object-cover rounded" />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <span>
                              {oi.storeItem.title} × {oi.quantity}
                            </span>
                            {formatCartVariantLabel(oi.variant) ? (
                              <p className="text-xs text-gray-600">{formatCartVariantLabel(oi.variant)}</p>
                            ) : null}
                          </div>
                        </div>
                        {pendingRefund ? null : (
                          <div className="-mx-6 mt-3 border-t border-neutral-200 px-6 pt-3">
                            {decided ? (
                              <p className="text-sm font-semibold text-gray-800">{decided}</p>
                            ) : (
                              <>
                                <p className="text-sm font-semibold text-gray-800">{stockChoiceLabel(oi)}</p>
                                <p className="mt-1 text-sm text-gray-600">
                                  If you&apos;re waiting for this item to be returned, ignore this. You can return the stock later.
                                </p>
                                <div className="mt-3 flex gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="btn flex-1 text-sm py-2 px-3"
                                    onClick={() =>
                                      postAction(order.id, "/stock-return", {
                                        orderItemId: oi.id,
                                        decision: "return",
                                      })
                                    }
                                  >
                                    Return
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="flex-1 text-sm py-2 px-3 border rounded-lg bg-white"
                                    onClick={() =>
                                      postAction(order.id, "/stock-return", {
                                        orderItemId: oi.id,
                                        decision: "withhold",
                                      })
                                    }
                                  >
                                    Don&apos;t Return
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {pendingRefund ? (
                  <div className="-mx-6 mb-4 border-t border-neutral-200 px-6 pt-3">
                    <p className="text-sm font-semibold text-gray-800">Approve this refund request?</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="btn flex-1 text-sm py-2 px-3"
                        onClick={() => postAction(order.id, "/returns/approve")}
                      >
                        {busy ? "Working…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="flex-1 text-sm py-2 px-3 border rounded-lg bg-white"
                        onClick={() => {
                          setDeclineFor(order.id);
                          setDeclineReason("");
                        }}
                      >
                        Decline
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      className="mt-3 text-sm py-2 px-3 border rounded-lg"
                      onClick={() => postAction(order.id, "/refund", { requireReturn: false })}
                    >
                      Courtesy refund (keep item)
                    </button>
                  </div>
                ) : null}
                <div
                  className={
                    orderCanBuyReturnLabel(order) &&
                    returnLabelIsDue(order) &&
                    (ret?.status === "awaiting_return" || ret?.status === "in_transit") &&
                    moneyAction
                      ? "grid w-full max-w-2xl grid-cols-2 items-start gap-x-3 gap-y-2"
                      : "flex flex-col items-start gap-2"
                  }
                >
                  {ret?.status === "awaiting_return" || ret?.status === "in_transit" ? (
                    <>
                      {orderCanBuyReturnLabel(order) && returnLabelIsDue(order) ? (
                        <div className="flex min-w-0 flex-col gap-2">
                          {ret.chargeReturnShipping ? (
                            <button
                              type="button"
                              className="btn w-full text-sm py-2 px-3"
                              disabled={busy}
                              onClick={() => setSendLabelOrder(order)}
                            >
                              Send Buyer Return Label
                            </button>
                          ) : (
                            <Link
                              href={`/seller-hub/orders/shippo/${order.id}?labelAction=return`}
                              className="btn w-full text-sm py-2 px-3 inline-block text-center"
                            >
                              Send Buyer Return Label
                            </Link>
                          )}
                          <ReturnLabelDueTag />
                        </div>
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
                    </>
                  ) : null}
                  {moneyAction ? (
                    <div className="flex min-w-0 flex-col items-center gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        className="btn w-full text-sm py-2 px-3"
                        onClick={() => {
                          if (moneyAction === "receive") {
                            setConfirmReceiveId(order.id);
                            return;
                          }
                          postAction(order.id, "/returns/receive");
                        }}
                      >
                        {busy ? "Refunding…" : storeReturnSellerMoneyActionLabel(moneyAction)}
                      </button>
                      {moneyAction === "receive" ? (
                        <p className="w-full text-center text-sm font-semibold" style={{ color: "#6b2430" }}>
                          (Refunds Automatic at Delivery)
                        </p>
                      ) : null}
                    </div>
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

      {sendLabelOrder ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-return-label-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 id="send-return-label-title" className="text-lg font-bold mb-2">
              Send Buyer Return Label
            </h3>
            {sendLabelOrder.storeReturn?.chargeReturnShipping && !sendLabelOrder.returnShipment?.labelUrl ? (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  This return can deduct the label from the refund. Choose before you buy it. The amount
                  is the Shippo price, and the buyer is told that amount after the label is bought.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="btn text-sm py-2 px-3"
                    disabled={busyId === sendLabelOrder.id}
                    onClick={() => void chooseLabelPayer(sendLabelOrder.id, "seller")}
                  >
                    I&apos;ll pay for this label
                  </button>
                  <button
                    type="button"
                    className="text-sm py-2 px-3 border rounded-lg"
                    disabled={busyId === sendLabelOrder.id}
                    onClick={() => void chooseLabelPayer(sendLabelOrder.id, "buyer")}
                  >
                    Deduct it from the refund
                  </button>
                  <button
                    type="button"
                    className="text-sm py-2 px-3"
                    onClick={() => setSendLabelOrder(null)}
                  >
                    Later
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  Opening Shippo with the buyer’s checkout address as the sender and your Shippo ship-from
                  as the return destination — the same as a regular shipment, reversed.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn text-sm py-2 px-3"
                    onClick={() => openReturnLabel(sendLabelOrder.id)}
                  >
                    Send Buyer Return Label
                  </button>
                  <button
                    type="button"
                    className="text-sm py-2 px-3 border rounded-lg"
                    onClick={() => setSendLabelOrder(null)}
                  >
                    Later
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <SellerReturnRefundChoiceModal
        open={choiceOrder != null}
        busy={choiceBusy}
        error={choiceError}
        onRefundNow={() => {
          if (choiceOrder) void chooseRefundTiming(choiceOrder.id, "now");
        }}
        onRefundWhenArrives={() => {
          if (choiceOrder) void chooseRefundTiming(choiceOrder.id, "on_arrival");
        }}
      />

      {confirmReceiveId ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-receive-refund-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 id="confirm-receive-refund-title" className="text-lg font-bold mb-2">
              Are you sure?
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              This marks the return received and refunds the buyer now.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 text-sm py-2 px-3 border rounded-lg bg-white"
                onClick={() => setConfirmReceiveId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn flex-1 text-sm py-2 px-3"
                disabled={busyId === confirmReceiveId}
                onClick={() => {
                  const orderId = confirmReceiveId;
                  setConfirmReceiveId(null);
                  postAction(orderId, "/returns/receive");
                }}
              >
                Mark Received & Refund
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
