"use client";

import { useEffect, useState } from "react";
import {
  BUYER_ORDER_REASONS,
  buyerItemPhoto,
  buyerItemTitle,
  buyerPaymentLabel,
  fulfillmentName,
  type BuyerOrderItem,
  type BuyerStoreOrder,
} from "@/lib/buyer-orders";

export type BuyerOrderModal =
  | { kind: "cancel"; order: BuyerStoreOrder }
  | { kind: "refund"; order: BuyerStoreOrder }
  | { kind: "pickup"; order: BuyerStoreOrder; item: BuyerOrderItem }
  | { kind: "delivery"; order: BuyerStoreOrder };

function overlayClass(open: boolean) {
  return open ? "fixed inset-0 z-[100] flex items-center justify-center p-4" : "hidden";
}

export function BuyerOrderModals({
  modal,
  onClose,
  onOrderPatched,
}: {
  modal: BuyerOrderModal | null;
  onClose: () => void;
  onOrderPatched: (orderId: string, patch: Partial<BuyerStoreOrder>) => void;
}) {
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const order = modal?.order ?? null;
  const modalKey = modal ? `${modal.kind}:${modal.order.id}` : "";

  useEffect(() => {
    setReason("");
    setOtherReason("");
    setNote("");
    setError(null);
  }, [modalKey]);

  function resetAndClose() {
    if (submitting) return;
    setReason("");
    setOtherReason("");
    setNote("");
    setError(null);
    onClose();
  }

  async function submitCancel() {
    if (!order) return;
    if (!reason) {
      setError("Please select a reason for cancellation.");
      return;
    }
    if (reason === "Other" && !otherReason.trim()) {
      setError('Please provide details for "Other".');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/store-orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          otherReason: reason === "Other" ? otherReason : undefined,
          note: note || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to cancel order.");
        return;
      }
      onOrderPatched(order.id, {
        status: (data as { refunded?: boolean }).refunded ? "refunded" : "canceled",
        cancelReason: reason,
        cancelNote: note || null,
      });
      setReason("");
      setOtherReason("");
      setNote("");
      onClose();
    } catch {
      setError("Failed to cancel order.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRefund() {
    if (!order) return;
    if (!reason) {
      setError("Please select a reason for your refund request.");
      return;
    }
    if (reason === "Other" && !otherReason.trim()) {
      setError('Please provide details for "Other".');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/store-orders/${order.id}/request-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          otherReason: reason === "Other" ? otherReason : undefined,
          note: note || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to request refund.");
        return;
      }
      const displayReason =
        reason === "Other" && otherReason ? `Other: ${otherReason}` : reason;
      onOrderPatched(order.id, {
        refundRequestedAt: new Date().toISOString(),
        refundReason: displayReason,
      });
      setReason("");
      setOtherReason("");
      setNote("");
      onClose();
    } catch {
      setError("Failed to request refund.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmReceived(kind: "pickup" | "delivery") {
    if (!order) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        kind === "pickup" ? { pickupBuyerConfirmed: true } : { deliveryBuyerConfirmed: true };
      const res = await fetch(`/api/store-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Could not update. Please try again.");
        return;
      }
      const patch: Partial<BuyerStoreOrder> = {
        status: typeof (data as { status?: string }).status === "string" ? (data as { status: string }).status : order.status,
      };
      if (kind === "pickup") patch.pickupBuyerConfirmedAt = new Date().toISOString();
      else patch.deliveryBuyerConfirmedAt = new Date().toISOString();
      onOrderPatched(order.id, patch);
      onClose();
    } catch {
      setError("Could not update. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!modal || !order) return null;

  if (modal.kind === "pickup" || modal.kind === "delivery") {
    const isPickup = modal.kind === "pickup";
    const photo = isPickup
      ? buyerItemPhoto(modal.item)
      : buyerItemPhoto(order.items.find((i) => (i.fulfillmentType ?? "") === "local_delivery"));
    const name = isPickup
      ? fulfillmentName(modal.item.pickupDetails)
      : fulfillmentName(order.localDeliveryDetails);
    const complete = isPickup
      ? !!(order.pickupSellerConfirmedAt && order.pickupBuyerConfirmedAt)
      : !!(order.deliveryConfirmedAt && order.deliveryBuyerConfirmedAt);
    const buyerDone = isPickup ? !!order.pickupBuyerConfirmedAt : !!order.deliveryBuyerConfirmedAt;
    const sellerDone = isPickup ? !!order.pickupSellerConfirmedAt : !!order.deliveryConfirmedAt;
    const title = isPickup ? "Pick Up Ticket" : "Delivery Ticket";

    return (
      <div className={overlayClass(true)}>
        <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={resetAndClose} />
        <div
          className="relative w-full max-w-md rounded-lg border-2 p-6 max-h-[90vh] overflow-y-auto"
          style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)" }}
        >
          <h3 className="text-lg font-bold mb-1" style={{ color: "var(--color-heading)" }}>
            {title}
          </h3>
          <p className="text-sm opacity-80 mb-4">
            {buyerItemTitle(isPickup ? modal.item : order.items[0] ?? { id: "", quantity: 1, priceCentsAtPurchase: 0 })}
          </p>
          {photo ? (
            <img src={photo} alt="" className="w-full aspect-square object-cover rounded-lg mb-4" />
          ) : null}
          <p className="font-semibold">{name}</p>
          <p className="text-sm opacity-80 mt-1">
            Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}
          </p>
          <p className="text-sm opacity-80 mb-4">{buyerPaymentLabel(order)}</p>
          {complete ? (
            <p className="text-sm mb-4" style={{ color: "var(--color-primary)" }}>
              {isPickup
                ? "Pickup is complete — you and the seller have both confirmed."
                : "Delivery is complete — the seller marked delivered and you confirmed receipt."}
            </p>
          ) : buyerDone ? (
            <p className="text-sm mb-4 opacity-80">
              You marked received. This finishes when the seller confirms too.
            </p>
          ) : (
            <>
              <p className="text-sm mb-4 opacity-80">
                {sellerDone
                  ? "The seller confirmed. Mark received when you have your items."
                  : "Show this ticket at pickup or delivery, then mark received."}
              </p>
              <button
                type="button"
                className="btn w-full text-white hover:text-white mb-3"
                style={{ backgroundColor: "var(--color-primary)" }}
                onClick={() => confirmReceived(isPickup ? "pickup" : "delivery")}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Mark received"}
              </button>
            </>
          )}
          {error ? <p className="text-sm text-red-700 mb-3">{error}</p> : null}
          <button
            type="button"
            className="w-full px-4 py-2 rounded border-2"
            style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            onClick={resetAndClose}
            disabled={submitting}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const isCancel = modal.kind === "cancel";
  return (
    <div className={overlayClass(true)}>
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={resetAndClose} />
      <div
        className="relative w-full max-w-xl rounded-lg border-2 p-6 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-primary)" }}
      >
        <h3 className="text-lg font-bold mb-3" style={{ color: "var(--color-heading)" }}>
          {isCancel ? "Cancel order" : "Request refund"}
        </h3>
        <p className="text-sm mb-4 opacity-80">
          {isCancel
            ? order.isCashOrder
              ? "This order was paid in cash. Canceling will release the items back to the seller. No refund is involved."
              : "This will cancel your order and refund the amount to your original payment method."
            : "The seller will review your request. Please provide a reason."}
        </p>
        <p className="text-sm font-medium mb-2">Reason (required)</p>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full border-2 rounded px-3 py-2 mb-4"
          style={{ borderColor: "var(--color-primary)" }}
          disabled={submitting}
        >
          <option value="">Select a reason…</option>
          {BUYER_ORDER_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {reason === "Other" && (
          <div className="mb-4">
            <p className="text-sm font-medium mb-1">Please specify</p>
            <textarea
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              placeholder="Describe your reason..."
              rows={2}
              className="w-full border-2 rounded px-3 py-2 resize-none"
              style={{ borderColor: "var(--color-primary)" }}
              disabled={submitting}
            />
          </div>
        )}
        <div className="mb-4">
          <p className="text-sm font-medium mb-1">Note for seller (optional)</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for the seller..."
            rows={2}
            className="w-full border-2 rounded px-3 py-2 resize-none"
            style={{ borderColor: "var(--color-primary)" }}
            disabled={submitting}
          />
        </div>
        {error ? <p className="text-sm text-red-700 mb-3">{error}</p> : null}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={resetAndClose}
            className="px-4 py-2 rounded border-2"
            style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
            disabled={submitting}
          >
            {isCancel ? "Keep order" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={isCancel ? submitCancel : submitRefund}
            disabled={submitting}
            className="btn text-white hover:text-white"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {submitting ? (isCancel ? "Processing…" : "Submitting…") : isCancel ? "Cancel order" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}
