import { BUYER_REFUND_TIMING_NOTE, storeOrderRefundPhase } from "@/lib/store-order-refund-status";

export type BuyerCommerceStatusTone = "pending" | "approved" | "moving" | "complete" | "declined";

export type BuyerCommerceStatus = {
  title: string;
  detail: string;
  note?: string;
  tone: BuyerCommerceStatusTone;
  icon: string;
};

type OrderLike = {
  status: string;
  isCashOrder?: boolean;
  refundInitiatedAt?: string | Date | null;
  refundCompletedAt?: string | Date | null;
  refundRequestedAt?: string | null;
  refundReason?: string | null;
  storeReturn?: { status: string; declineReason?: string | null } | null;
  returnShipment?: { labelUrl?: string | null } | null;
};

function status(partial: Omit<BuyerCommerceStatus, "note"> & { note?: string }): BuyerCommerceStatus {
  return partial;
}

/** Title and short detail for a buyer refund or return, when one is in progress. */
export function buyerCommerceStatus(order: OrderLike): BuyerCommerceStatus | null {
  const phase = storeOrderRefundPhase(order);
  if (phase === "complete") {
    return status({
      title: "Refund complete",
      detail: BUYER_REFUND_TIMING_NOTE,
      tone: "complete",
      icon: "checkmark-done-outline",
    });
  }
  if (phase === "initiated") {
    return status({
      title: "Refund initiated",
      detail: BUYER_REFUND_TIMING_NOTE,
      tone: "moving",
      icon: "card-outline",
    });
  }

  const ret = order.storeReturn;
  if (ret?.status === "requested") {
    return status({
      title: "Return requested",
      detail: "The seller will review.",
      tone: "pending",
      icon: "time-outline",
    });
  }
  if (ret?.status === "awaiting_return") {
    const hasLabel = Boolean(order.returnShipment?.labelUrl);
    return status({
      title: "Return approved",
      detail: hasLabel ? "Print your return label." : "A return label is on the way.",
      tone: "approved",
      icon: hasLabel ? "print-outline" : "checkmark-circle-outline",
    });
  }
  if (ret?.status === "in_transit") {
    return status({
      title: "Return in progress",
      detail: "On the way back to the seller.",
      tone: "moving",
      icon: "swap-horizontal-outline",
    });
  }
  if (ret?.status === "received") {
    return status({
      title: "Return received",
      detail: "Your refund is processing.",
      tone: "moving",
      icon: "cube-outline",
    });
  }
  if (ret?.status === "refunded") {
    return status({
      title: "Refund initiated",
      detail: BUYER_REFUND_TIMING_NOTE,
      tone: "moving",
      icon: "card-outline",
    });
  }
  if (ret?.status === "declined") {
    return status({
      title: "Return declined",
      detail: ret.declineReason?.trim() || "The seller declined this request.",
      tone: "declined",
      icon: "close-circle-outline",
    });
  }
  if (ret?.status === "canceled") {
    return status({
      title: "Return canceled",
      detail: "This return was canceled.",
      tone: "declined",
      icon: "close-circle-outline",
    });
  }

  if (order.refundRequestedAt) {
    return status({
      title: "Refund requested",
      detail: "The seller will review.",
      note: order.refundReason?.trim() || undefined,
      tone: "pending",
      icon: "time-outline",
    });
  }

  return null;
}
