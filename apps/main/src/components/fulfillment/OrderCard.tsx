"use client";

import Link from "next/link";
import type { KeyboardEvent, MouseEvent } from "react";
import { formatShippingAddress } from "@/lib/format-address";
import { getStoreOrderStatusLabel } from "@/lib/order-status";
import {
  formatSellerOrderTotal,
  orderFulfillmentBadge,
  sellerOrderPaymentLabel,
} from "@/lib/store-order-fulfillment";
import type { FulfillmentStoreOrder } from "./types";
import { parseBuyerResponseViews } from "@/lib/buyer-response-lines";

type OrderCardProps = {
  order: FulfillmentStoreOrder;
  ordersBasePath: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (orderId: string) => void;
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
                  "var(--color-section-alt)",
                color: "var(--color-primary)",
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
                {getStoreOrderStatusLabel(order)}
              </span>
            ) : null}
          </div>

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

function orderDisplayNumber(order: { id: string; orderNumber?: string | null }) {
  return order.orderNumber ?? order.id.slice(-8).toUpperCase();
}

export function CombinedOrderCard({
  orders,
  ordersBasePath,
  selected,
  onToggle,
  onSeparate,
}: {
  orders: FulfillmentStoreOrder[];
  ordersBasePath: string;
  selected: boolean;
  onToggle: () => void;
  onSeparate: () => void;
}) {
  const label = orders.map((order) => `#${orderDisplayNumber(order)}`).join(", ");
  const buyer = orders[0]?.buyer;
  const address = formatShippingAddress(orders[0]?.shippingAddress) || "";

  return (
    <article
      className={`rounded-xl border bg-white p-4 shadow-sm cursor-pointer ${
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-section-alt)]"
          : "border-[var(--color-primary)]"
      }`}
      onClick={onToggle}
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select combined orders ${label}`}
    >
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} readOnly tabIndex={-1} aria-hidden className="pointer-events-none mt-1" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Order {label}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">
            {[buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ") || "Customer"} · one shipment
          </p>
          {address ? <p className="text-sm text-gray-500 mt-1">{address}</p> : null}
          <ul className="mt-3 space-y-2">
            {orders.map((order) => (
              <li key={order.id} className="text-sm text-gray-800">
                <Link
                  href={`${ordersBasePath}/${order.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium hover:underline"
                  style={{ color: "var(--color-link)" }}
                >
                  #{orderDisplayNumber(order)}
                </Link>
                <span className="text-gray-600">
                  {" "}
                  {(order.items ?? [])
                    .map((item) => `${item.storeItem?.title ?? "Item"} × ${item.quantity}`)
                    .join(" · ") || "—"}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-3 text-sm underline"
            style={{ color: "var(--color-earth, #5d4f40)" }}
            onClick={(e) => {
              e.stopPropagation();
              onSeparate();
            }}
          >
            Separate
          </button>
        </div>
      </div>
    </article>
  );
}

function isPreviewableImage(url: string): boolean {
  return /\.(jpe?g|png|gif|webp|heic|svg)(\?|$)/i.test(url);
}

function BuyerResponseDetails({ raw }: { raw: unknown }) {
  const rows = parseBuyerResponseViews(raw);
  if (rows.length === 0) return null;
  const choices = rows.filter((row) => row.kind !== "FILE");
  const uploads = rows.filter((row) => row.kind === "FILE");
  return (
    <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
      {choices.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {choices.map((row, index) => (
            <div key={`${row.kind}-${index}`}>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{row.title}</dt>
              <dd className="mt-1 text-sm text-gray-900 break-words">
                {row.kind === "TEXT" ? row.text : row.optionLabel}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {uploads.map((row, index) => (
        <div key={`${row.kind}-${index}`}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{row.title}</p>
          <ul className="mt-2 flex flex-wrap gap-3">
            {row.files.map((file) => {
              const name = file.label || "File";
              const image = isPreviewableImage(file.url);
              return (
                <li key={file.url} className="w-40 overflow-hidden rounded-lg border border-gray-200 bg-white">
                  {image ? (
                    <a href={file.url} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={file.url} alt={name} className="h-28 w-full object-cover" />
                    </a>
                  ) : (
                    <div className="flex h-28 items-center justify-center bg-gray-50 px-3 text-center text-xs text-gray-500">
                      {name}
                    </div>
                  )}
                  <div className="space-y-1 px-3 py-2">
                    <p className="truncate text-sm font-medium text-gray-900">{name}</p>
                    <a
                      href={file.url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-sm underline"
                      style={{ color: "var(--color-link)" }}
                    >
                      Download
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Item rows for the seller order detail page. */
export function OrderCardItemRows({ order }: { order: FulfillmentStoreOrder }) {
  return (
    <ul className="space-y-4">
      {(order.items ?? []).map((oi) => (
        <li key={oi.id} className="rounded-lg border border-gray-200 p-4">
          <div className="flex items-start gap-3">
            {oi.storeItem.photos[0] ? (
              <img src={oi.storeItem.photos[0]} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-lg bg-gray-100" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900">{oi.storeItem.title}</p>
              <p className="mt-0.5 text-sm text-gray-500">
                Qty {oi.quantity}
                {oi.priceCentsAtPurchase != null
                  ? ` · $${((oi.priceCentsAtPurchase * oi.quantity) / 100).toFixed(2)}`
                  : ""}
              </p>
            </div>
          </div>
          <BuyerResponseDetails raw={oi.buyerResponses} />
        </li>
      ))}
    </ul>
  );
}
