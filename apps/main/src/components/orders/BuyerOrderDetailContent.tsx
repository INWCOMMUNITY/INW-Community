"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";
import { BuyerOrderModals, type BuyerOrderModal } from "@/components/orders/BuyerOrderModals";
import { formatShippingAddress } from "@/lib/format-address";
import { buildBusinessHref } from "@/lib/business-referrer";
import { buildProductHref } from "@/lib/product-referrer";
import {
  buyerFulfillmentHeadline,
  buyerItemPhoto,
  buyerItemTitle,
  buyerPaymentLabel,
  buyerSellerId,
  buyerSellerName,
  buyerShopSlug,
  buyerTrackingHref,
  canCancelBuyerOrder,
  canRequestBuyerRefund,
  formatBuyerOrderDate,
  formatBuyerPrice,
  trackingStatusLabel,
  type BuyerStoreOrder,
} from "@/lib/buyer-orders";
import { orderHasLocalDeliveryLine, orderHasPickupLine } from "@/lib/store-order-fulfillment";

const outlineBtn =
  "inline-flex items-center justify-center gap-1 rounded-lg border-2 border-[var(--color-primary)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-primary)] hover:opacity-90";

export function BuyerOrderDetailContent() {
  const params = useParams<{ id: string }>();
  const orderId = typeof params?.id === "string" ? params.id : "";
  const [order, setOrder] = useState<BuyerStoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<BuyerOrderModal | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    if (!orderId) {
      setLoading(false);
      setError("Order not found");
      return;
    }
    setError(null);
    setLoading(true);
    fetch(`/api/store-orders/${orderId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError((data as { error?: string }).error ?? "Failed to load order.");
          setOrder(null);
          return;
        }
        setOrder(data as BuyerStoreOrder);
      })
      .catch(() => {
        setError("Failed to load order.");
        setOrder(null);
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  function patchOrder(_id: string, patch: Partial<BuyerStoreOrder>) {
    setOrder((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function copyTracking(tracking: string) {
    try {
      await navigator.clipboard.writeText(tracking);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (loading) {
    return <p className="text-gray-500">Loading order…</p>;
  }

  if (error || !order) {
    return (
      <div>
        <Link
          href="/my-community/orders"
          className="inline-flex items-center gap-2 rounded-full border-2 px-3 py-2 font-medium mb-4 hover:opacity-90 w-fit"
          style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
        >
          <IonIcon name="arrow-back" size={22} />
          Back to My Orders
        </Link>
        <p className="text-red-700 mb-4">{error ?? "Order not found"}</p>
        <button type="button" className="btn" onClick={load}>
          Try again
        </button>
      </div>
    );
  }

  const orderNum = order.orderNumber ?? order.id.slice(-8).toUpperCase();
  const sellerName = buyerSellerName(order);
  const sellerId = buyerSellerId(order);
  const shopSlug = buyerShopSlug(order);
  const trackingHref = buyerTrackingHref(order.shipment);
  const trackingNumber = order.shipment?.trackingNumber?.trim() || null;
  const address = formatShippingAddress(order.shippingAddress);
  const items = order.items ?? [];
  const pickupItem = items.find((i) => (i.fulfillmentType ?? "") === "pickup");
  const activeFulfillment = order.status === "paid" || order.status === "shipped" || order.status === "delivered";
  const showPickup = orderHasPickupLine(items) && pickupItem && activeFulfillment;
  const showDelivery = orderHasLocalDeliveryLine(items) && activeFulfillment;
  const firstSlug = items.find((i) => i.storeItem?.slug)?.storeItem?.slug;
  const productRef = { type: "order" as const, orderId: order.id, orderKind: "buyer" as const };

  return (
    <div>
      <Link
        href="/my-community/orders"
        className="inline-flex items-center gap-2 rounded-full border-2 px-3 py-2 font-medium mb-4 hover:opacity-90 w-fit"
        style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
      >
        <IonIcon name="arrow-back" size={22} />
        Back to My Orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-heading)" }}>
            Order #{orderNum}
          </h1>
          <p className="opacity-80 mt-1">{formatBuyerOrderDate(order.createdAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">{formatBuyerPrice(order.totalCents)}</p>
          <span
            className="inline-block mt-1 px-2 py-0.5 rounded text-sm font-medium"
            style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
          >
            {buyerFulfillmentHeadline(order)}
          </span>
        </div>
      </div>

      <section className="mb-6">
        <p className="text-xs uppercase tracking-wide opacity-70 mb-1">Payment</p>
        <p className="font-medium" style={{ color: order.isCashOrder ? "#92400e" : undefined }}>
          {buyerPaymentLabel(order)}
        </p>
        {order.isCashOrder ? (
          <p className="text-sm opacity-80 mt-1">Pay the seller when you pick up or receive delivery.</p>
        ) : null}
      </section>

      <section className="mb-6">
        <p className="text-xs uppercase tracking-wide opacity-70 mb-1">Seller</p>
        <p className="font-medium">{sellerName}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {shopSlug ? (
            <Link href={buildBusinessHref(shopSlug, { type: "directory" })} className={outlineBtn}>
              Visit shop
            </Link>
          ) : null}
          {sellerId ? (
            <Link href={`/my-community/messages?addresseeId=${encodeURIComponent(sellerId)}`} className={outlineBtn}>
              Message seller
            </Link>
          ) : null}
        </div>
      </section>

      <section className="mb-6">
        <p className="text-xs uppercase tracking-wide opacity-70 mb-3">Items</p>
        {items.length === 0 ? (
          <p className="text-sm opacity-80">Item no longer available</p>
        ) : (
          <ul className="space-y-3">
            {items.map((oi) => {
              const title = buyerItemTitle(oi);
              const photo = buyerItemPhoto(oi);
              const slug = oi.storeItem?.slug;
              const body = (
                <div className="flex items-center gap-3">
                  {photo ? (
                    <img src={photo} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div
                      className="w-16 h-16 rounded-lg shrink-0 flex items-center justify-center font-semibold"
                      style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                    >
                      {title[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium">{title}</p>
                    <p className="text-sm opacity-80">
                      Qty {oi.quantity} · {formatBuyerPrice(oi.priceCentsAtPurchase * oi.quantity)}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={oi.id}>
                  {slug ? (
                    <Link href={buildProductHref(slug, productRef)} className="block hover:opacity-90">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mb-6 space-y-1 text-sm">
        {order.subtotalCents != null ? (
          <div className="flex justify-between">
            <span className="opacity-80">Subtotal</span>
            <span>{formatBuyerPrice(order.subtotalCents)}</span>
          </div>
        ) : null}
        {(order.shippingCostCents ?? 0) > 0 ? (
          <div className="flex justify-between">
            <span className="opacity-80">Shipping</span>
            <span>{formatBuyerPrice(order.shippingCostCents ?? 0)}</span>
          </div>
        ) : null}
        {(order.taxCents ?? 0) > 0 ? (
          <div className="flex justify-between">
            <span className="opacity-80">Tax</span>
            <span>{formatBuyerPrice(order.taxCents ?? 0)}</span>
          </div>
        ) : null}
        <div className="flex justify-between font-semibold pt-1">
          <span>Total</span>
          <span>{formatBuyerPrice(order.totalCents)}</span>
        </div>
      </section>

      {address ? (
        <section className="mb-6">
          <p className="text-xs uppercase tracking-wide opacity-70 mb-1">Ship to</p>
          <p className="whitespace-pre-line text-sm">{address}</p>
        </section>
      ) : null}

      <section className="mb-6">
        <p className="text-xs uppercase tracking-wide opacity-70 mb-1">Shipping</p>
        {trackingNumber ? (
          <>
            <p className="text-sm">
              {order.shipment?.carrier}
              {order.shipment?.service ? ` ${order.shipment.service}` : ""}
              {trackingStatusLabel(order.shipment?.trackingStatus)
                ? ` · ${trackingStatusLabel(order.shipment?.trackingStatus)}`
                : ""}
            </p>
            <p className="text-sm mt-1 font-mono">{trackingNumber}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {trackingHref ? (
                <a href={trackingHref} target="_blank" rel="noopener noreferrer" className={outlineBtn}>
                  Track package
                </a>
              ) : null}
              <button type="button" className={outlineBtn} onClick={() => copyTracking(trackingNumber)}>
                {copied ? "Copied" : "Copy tracking"}
              </button>
            </div>
          </>
        ) : orderHasPickupLine(items) || orderHasLocalDeliveryLine(items) ? (
          <p className="text-sm opacity-80">No mail shipment — use the ticket below.</p>
        ) : (
          <p className="text-sm opacity-80">Seller hasn’t shipped yet.</p>
        )}
      </section>

      {order.refundRequestedAt ? (
        <p className="text-sm mb-6" style={{ color: "var(--color-primary)" }}>
          Refund requested {formatBuyerOrderDate(order.refundRequestedAt)}. The seller will review.
          {order.refundReason ? <span className="block mt-1 opacity-90">Reason: {order.refundReason}</span> : null}
        </p>
      ) : null}

      {order.status === "canceled" && (order.cancelReason || order.cancelNote) ? (
        <p className="text-sm mb-6 opacity-80">
          {[order.cancelReason, order.cancelNote].filter(Boolean).join(" — ")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-8">
        {showPickup && pickupItem ? (
          <button type="button" className={outlineBtn} onClick={() => setModal({ kind: "pickup", order, item: pickupItem })}>
            Pick up ticket
          </button>
        ) : null}
        {showDelivery ? (
          <button type="button" className={outlineBtn} onClick={() => setModal({ kind: "delivery", order })}>
            Delivery ticket
          </button>
        ) : null}
        {canCancelBuyerOrder(order) ? (
          <button type="button" className={outlineBtn} onClick={() => setModal({ kind: "cancel", order })}>
            Cancel order
          </button>
        ) : null}
        {canRequestBuyerRefund(order) ? (
          <button type="button" className={outlineBtn} onClick={() => setModal({ kind: "refund", order })}>
            Request refund
          </button>
        ) : null}
        {firstSlug ? (
          <Link href={buildProductHref(firstSlug, productRef)} className={outlineBtn}>
            Order again
          </Link>
        ) : null}
      </div>

      <BuyerOrderModals modal={modal} onClose={() => setModal(null)} onOrderPatched={patchOrder} />
    </div>
  );
}
