"use client";

import { useState } from "react";
import Link from "next/link";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";
import { getTrackingUrl } from "@/lib/store-order-fulfillment";
import { OrderCard } from "./OrderCard";
import { OrderEmptyState } from "./OrderEmptyState";
import type { FulfillmentStoreOrder } from "./types";

function shippoLabelPageHref(orderId: string, labelAction: "reprint" | "another") {
  const q = new URLSearchParams({ labelAction });
  return `/seller-hub/orders/shippo/${orderId}?${q.toString()}`;
}

function LabelActionsMenu({
  order,
  ordersBasePath,
  menuOpenId,
  setMenuOpenId,
}: {
  order: FulfillmentStoreOrder;
  ordersBasePath: string;
  menuOpenId: string | null;
  setMenuOpenId: (id: string | null) => void;
}) {
  if (!order.shipment) return null;
  const canReprint =
    !!order.shipment.createdAt && isWithinLabelReprintWindow(order.shipment.createdAt);
  const canRepurchase = !canReprint;

  return (
    <div className="relative">
      <button
        type="button"
        className="w-9 h-9 rounded border border-gray-300 text-lg leading-none text-gray-700 hover:bg-gray-50"
        aria-label="Order actions"
        onClick={() => setMenuOpenId(menuOpenId === order.id ? null : order.id)}
      >
        ⋮
      </button>
      {menuOpenId === order.id ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => setMenuOpenId(null)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-52 text-sm">
            <Link
              href={`${ordersBasePath}/${order.id}`}
              className="block px-3 py-2 hover:bg-gray-50"
              style={{ color: "var(--color-link)" }}
              onClick={() => setMenuOpenId(null)}
            >
              View order
            </Link>
            {order.shipment.labelUrl ? (
              <a
                href={order.shipment.labelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-3 py-2 hover:bg-gray-50"
                style={{ color: "var(--color-link)" }}
                onClick={() => setMenuOpenId(null)}
              >
                Open label PDF
              </a>
            ) : null}
            {canReprint && order.shipment.shippoOrderId ? (
              <Link
                href={shippoLabelPageHref(order.id, "reprint")}
                className="block px-3 py-2 hover:bg-gray-50 text-[var(--color-primary)]"
                onClick={() => setMenuOpenId(null)}
              >
                Reprint label
              </Link>
            ) : null}
            {canRepurchase ? (
              <Link
                href={shippoLabelPageHref(order.id, "another")}
                className="block px-3 py-2 hover:bg-gray-50 text-[var(--color-primary)]"
                onClick={() => setMenuOpenId(null)}
              >
                Repurchase label
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ShippedOrderSection({
  shippedOrders,
  ordersBasePath,
  loading,
}: {
  shippedOrders: FulfillmentStoreOrder[];
  ordersBasePath: string;
  loading?: boolean;
}) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  if (shippedOrders.length === 0) {
    return <OrderEmptyState tab="shipped" />;
  }

  return (
    <ul className="space-y-3">
      {shippedOrders.map((order) => (
        <li key={order.id}>
          <OrderCard
            order={order}
            ordersBasePath={ordersBasePath}
            showStatus
            trailing={
              order.shipment?.trackingNumber ? (
                <p className="text-sm mt-2">
                  <a
                    href={getTrackingUrl(order.shipment.carrier, order.shipment.trackingNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    style={{ color: "var(--color-link)" }}
                  >
                    {order.shipment.carrier} {order.shipment.trackingNumber}
                  </a>
                </p>
              ) : null
            }
            menu={
              <LabelActionsMenu
                order={order}
                ordersBasePath={ordersBasePath}
                menuOpenId={menuOpenId}
                setMenuOpenId={setMenuOpenId}
              />
            }
          />
        </li>
      ))}
    </ul>
  );
}

export function HistoryOrderSection({
  deliveredOrders,
  canceledOrders,
  ordersBasePath,
  loading,
}: {
  deliveredOrders: FulfillmentStoreOrder[];
  canceledOrders: FulfillmentStoreOrder[];
  ordersBasePath: string;
  loading?: boolean;
}) {
  const [subTab, setSubTab] = useState<"delivered" | "canceled">("delivered");
  const orders = subTab === "delivered" ? deliveredOrders : canceledOrders;

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
        {(["delivered", "canceled"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubTab(key)}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              subTab === key
                ? "bg-white text-[var(--color-primary)] shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {key === "delivered" ? "Delivered" : "Canceled"}
            <span className="ml-1.5 text-xs opacity-70">
              ({key === "delivered" ? deliveredOrders.length : canceledOrders.length})
            </span>
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <OrderEmptyState tab="history" />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderCard order={order} ordersBasePath={ordersBasePath} showStatus />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
