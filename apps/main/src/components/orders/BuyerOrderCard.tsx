"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import {
  buyerCoverPhoto,
  buyerFulfillmentHeadline,
  buyerItemPhoto,
  buyerItemTitle,
  buyerOrderTitle,
  buyerPaymentLabel,
  buyerSellerName,
  buyerTrackingHref,
  canCancelBuyerOrder,
  canRequestBuyerRefund,
  formatBuyerOrderDate,
  formatBuyerPrice,
  type BuyerStoreOrder,
} from "@/lib/buyer-orders";
import { orderHasLocalDeliveryLine, orderHasPickupLine } from "@/lib/store-order-fulfillment";
import type { BuyerOrderModal } from "@/components/orders/BuyerOrderModals";

const outlineBtn =
  "inline-flex items-center justify-center gap-1 rounded-lg border-2 border-[var(--color-primary)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--color-primary)] hover:opacity-90";

function ItemThumb({ src, title }: { src?: string; title: string }) {
  if (src) {
    return <img src={src} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />;
  }
  return (
    <div
      className="w-10 h-10 rounded-md shrink-0 flex items-center justify-center text-sm font-semibold"
      style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
      aria-hidden
    >
      {title[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

export function BuyerOrderCard({
  order,
  onAction,
}: {
  order: BuyerStoreOrder;
  onAction: (modal: BuyerOrderModal) => void;
}) {
  const orderNum = order.orderNumber ?? order.id.slice(-8).toUpperCase();
  const detailHref = `/my-community/orders/${order.id}`;
  const cover = buyerCoverPhoto(order);
  const sellerName = buyerSellerName(order);
  const headline = buyerFulfillmentHeadline(order);
  const trackingHref = buyerTrackingHref(order.shipment);
  const items = order.items ?? [];
  const pickupItem = items.find((i) => (i.fulfillmentType ?? "") === "pickup");
  const showPickup = orderHasPickupLine(items) && pickupItem && (order.status === "paid" || order.status === "shipped" || order.status === "delivered");
  const showDelivery =
    orderHasLocalDeliveryLine(items) &&
    (order.status === "paid" || order.status === "shipped" || order.status === "delivered");
  const canCancel = canCancelBuyerOrder(order);
  const canRefund = canRequestBuyerRefund(order);

  return (
    <article
      className="rounded-xl border-2 bg-white p-4 sm:p-5"
      style={{ borderColor: "var(--color-primary)" }}
    >
      <div className="flex gap-4">
        <Link href={detailHref} className="shrink-0">
          {cover ? (
            <img src={cover} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover" />
          ) : (
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
              aria-hidden
            >
              <IonIcon name="receipt-outline" size={32} />
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={detailHref} className="font-semibold hover:underline line-clamp-2" style={{ color: "var(--color-heading)" }}>
                {buyerOrderTitle(order)}
              </Link>
              <p className="text-sm opacity-80">{sellerName}</p>
              <p className="text-sm opacity-70">
                Order #{orderNum} · {formatBuyerOrderDate(order.createdAt)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold">{formatBuyerPrice(order.totalCents)}</p>
              <span
                className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium"
                style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
              >
                {headline}
              </span>
              <p
                className="text-xs mt-1 font-medium"
                style={{ color: order.isCashOrder ? "#92400e" : "var(--color-primary)" }}
              >
                {buyerPaymentLabel(order)}
              </p>
            </div>
          </div>

          <ul className="mt-3 space-y-2">
            {items.length === 0 ? (
              <li className="flex items-center gap-2 text-sm opacity-80">
                <ItemThumb title="Item no longer available" />
                <span>Item no longer available</span>
              </li>
            ) : (
              items.map((oi) => {
                const title = buyerItemTitle(oi);
                return (
                  <li key={oi.id} className="flex items-center gap-2 text-sm min-w-0">
                    <ItemThumb src={buyerItemPhoto(oi)} title={title} />
                    <span className="min-w-0 truncate">
                      {title} × {oi.quantity}
                      <span className="opacity-70"> — {formatBuyerPrice(oi.priceCentsAtPurchase * oi.quantity)}</span>
                    </span>
                  </li>
                );
              })
            )}
          </ul>

          {order.refundRequestedAt ? (
            <p className="text-sm mt-3" style={{ color: "var(--color-primary)" }}>
              Refund requested {formatBuyerOrderDate(order.refundRequestedAt)}. The seller will review.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 mt-4">
            <Link href={detailHref} className={outlineBtn}>
              View Details
            </Link>
            {trackingHref ? (
              <a href={trackingHref} target="_blank" rel="noopener noreferrer" className={outlineBtn}>
                Track package
              </a>
            ) : null}
            {showPickup && pickupItem ? (
              <button type="button" className={outlineBtn} onClick={() => onAction({ kind: "pickup", order, item: pickupItem })}>
                Pick up ticket
              </button>
            ) : null}
            {showDelivery ? (
              <button type="button" className={outlineBtn} onClick={() => onAction({ kind: "delivery", order })}>
                Delivery ticket
              </button>
            ) : null}
            {canCancel ? (
              <button type="button" className={outlineBtn} onClick={() => onAction({ kind: "cancel", order })}>
                Cancel order
              </button>
            ) : null}
            {canRefund ? (
              <button type="button" className={outlineBtn} onClick={() => onAction({ kind: "refund", order })}>
                Request refund
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
