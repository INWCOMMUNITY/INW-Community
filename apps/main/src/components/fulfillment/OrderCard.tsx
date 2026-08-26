"use client";

import Link from "next/link";
import type { KeyboardEvent, MouseEvent } from "react";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";
import {
  formatSellerOrderTotal,
  isOrderEligibleForToShipQueue,
  orderFulfillmentBadge,
  sellerOrderPaymentLabel,
} from "@/lib/store-order-fulfillment";
import type { FulfillmentStoreOrder } from "./types";

type OrderCardProps = {
  order: FulfillmentStoreOrder;
  ordersBasePath: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (orderId: string) => void;
  onMarkShipped?: (orderId: string) => void;
  markingShipped?: boolean;
  showStatus?: boolean;
  menu?: React.ReactNode;
  trailing?: React.ReactNode;
};

export function OrderCard({
  order,
  ordersBasePath,
  selectable,
  selected,
  onToggleSelect,
  onMarkShipped,
  markingShipped,
  showStatus,
  menu,
  trailing,
}: OrderCardProps) {
  const orderNum = order.orderNumber ?? order.id.slice(-8).toUpperCase();
  const photos = (order.items ?? [])
    .flatMap((i) => i.storeItem?.photos ?? [])
    .slice(0, 4);
  const itemSummary = (order.items ?? [])
    .map((i) => `${i.storeItem?.title ?? "Item"} × ${i.quantity}`)
    .join(" · ");
  const paymentLabel = sellerOrderPaymentLabel(order);
  const canMarkShipped = isOrderEligibleForToShipQueue(order) && onMarkShipped;
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm transition-colors ${
        selectable
          ? `cursor-pointer hover:border-[var(--color-primary)] hover:bg-[var(--color-section-alt)] ${
              selected
                ? "border-[var(--color-primary)] bg-[var(--color-section-alt)]"
                : "border-gray-200"
            }`
          : "border-gray-200"
      }`}
      onClick={selectable ? () => onToggleSelect?.(order.id) : undefined}
      onKeyDown={
        selectable
          ? (e: KeyboardEvent<HTMLElement>) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onToggleSelect?.(order.id);
              }
            }
          : undefined
      }
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? !!selected : undefined}
      aria-label={selectable ? `Select order ${orderNum}` : undefined}
      tabIndex={selectable ? 0 : undefined}
    >
      <div className="flex flex-wrap items-start gap-4">
        {selectable ? (
          <input
            type="checkbox"
            checked={!!selected}
            readOnly
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none mt-1 shrink-0"
          />
        ) : null}

        {photos.length > 0 ? (
          <div className="flex gap-1 shrink-0">
            {photos.map((src, idx) => (
              <img
                key={`${src}-${idx}`}
                src={src}
                alt=""
                className="w-12 h-12 rounded-lg object-cover border border-gray-100"
              />
            ))}
          </div>
        ) : (
          <div className="w-12 h-12 rounded-lg bg-gray-100 shrink-0" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`${ordersBasePath}/${order.id}`}
                onClick={stop}
                className="font-semibold hover:underline inline-flex flex-wrap items-center gap-x-2 gap-y-0"
                style={{ color: "var(--color-link)" }}
              >
                <span>Order #{orderNum}</span>
                {order.orderKind === "reward_redemption" ? (
                  <span className="text-xs font-semibold uppercase text-amber-800">Reward</span>
                ) : null}
              </Link>
              <p className="text-sm text-gray-600 mt-0.5">
                {[order.buyer?.firstName, order.buyer?.lastName].filter(Boolean).join(" ") || "Customer"}{" "}
                · {new Date(order.createdAt).toLocaleString()}
              </p>
            </div>
            <p className="font-semibold shrink-0">{formatSellerOrderTotal(order)}</p>
          </div>

          <p className="text-sm text-gray-700 mt-2 line-clamp-2">{itemSummary || "—"}</p>

          {order.shippingAddress != null ? (
            <p className="text-sm text-gray-500 mt-1">
              {formatShippingAddress(order.shippingAddress) || "—"}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 mt-2">
            <span
              className="inline-block px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor:
                  paymentLabel === "Cash due" ? "#fef3c7" : "var(--color-section-alt)",
                color: paymentLabel === "Cash due" ? "#92400e" : "var(--color-primary)",
              }}
            >
              {paymentLabel}
            </span>
            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
              {orderFulfillmentBadge(order)}
            </span>
            {showStatus ? (
              <span
                className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
              >
                {getOrderStatusLabel(order.status)}
              </span>
            ) : null}
          </div>

          {canMarkShipped ? (
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                onMarkShipped(order.id);
              }}
              disabled={markingShipped}
              className="mt-3 text-sm font-medium px-3 py-1.5 rounded-lg border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-section-alt)] disabled:opacity-50"
            >
              {markingShipped ? "Saving…" : "Mark shipped (no label)"}
            </button>
          ) : null}

          {trailing ? <div onClick={stop}>{trailing}</div> : null}
        </div>

        {menu ? (
          <div className="shrink-0" onClick={stop}>
            {menu}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** Compact item rows for order detail sidebar / two-column layout. */
export function OrderCardItemRows({ order }: { order: FulfillmentStoreOrder }) {
  return (
    <ul className="space-y-3">
      {(order.items ?? []).map((oi) => (
        <li key={oi.id} className="flex items-center gap-3">
          {oi.storeItem.photos[0] ? (
            <img src={oi.storeItem.photos[0]} alt="" className="w-12 h-12 object-cover rounded-lg" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gray-100" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900">{oi.storeItem.title}</p>
            <p className="text-xs text-gray-500">
              Qty {oi.quantity}
              {oi.priceCentsAtPurchase != null
                ? ` · $${((oi.priceCentsAtPurchase * oi.quantity) / 100).toFixed(2)}`
                : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
