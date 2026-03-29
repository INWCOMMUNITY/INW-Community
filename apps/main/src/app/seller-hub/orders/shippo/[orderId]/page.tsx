"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import Script from "next/script";
import { useParams } from "next/navigation";
import { ShippoElementsModal } from "@/components/ShippoElementsModal";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";
import {
  useShippoLabelFlowForOrder,
  SHIPPO_EMBEDDABLE_URL,
  getNwAppShippoSkippedReason,
  readNwAppShippoModeFromWindow,
  type StoreOrderForShippo,
} from "@/hooks/use-shippo-label-flow-for-order";

const SHIPPO_CONTAINER_ID_THIN = "shippo-elements-container-order-thin";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface Shipment {
  id: string;
  carrier: string;
  service: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  shippoOrderId?: string | null;
  createdAt?: string;
}

interface StoreOrder extends StoreOrderForShippo {
  orderNumber?: string;
  orderKind?: string;
  totalCents: number;
  shippingCostCents: number;
  status: string;
  stripePaymentIntentId?: string | null;
  shippingAddress: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  shipment?: Shipment | null;
}

export default function SellerShippoThinLabelPage() {
  const params = useParams();
  const orderId = typeof params?.orderId === "string" ? params.orderId : "";

  const capturedNwAppShippo = useMemo(() => {
    if (typeof window === "undefined") return null;
    return readNwAppShippoModeFromWindow();
  }, []);

  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [autoOpenBlockedReason, setAutoOpenBlockedReason] = useState<string | null>(null);

  const refetchOrder = useCallback(() => {
    if (!orderId) return;
    fetch(`/api/store-orders/${orderId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return null;
        return data as StoreOrder;
      })
      .then((data) => data && setOrder(data));
  }, [orderId]);

  const {
    elementsLoading,
    elementsError,
    shippoModalOpen,
    openElementsFlow,
    closeShippoModal,
  } = useShippoLabelFlowForOrder({
    orderId,
    containerId: SHIPPO_CONTAINER_ID_THIN,
    order,
    orderLoading: loading,
    onLabelSaved: refetchOrder,
  });

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    setFetchError(null);
    fetch(`/api/store-orders/${orderId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setFetchError((data as { error?: string }).error ?? "Failed to load order.");
          return null;
        }
        return data as StoreOrder;
      })
      .then(setOrder)
      .catch(() => {
        setFetchError("Connection failed.");
        setOrder(null);
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  useEffect(() => {
    if (!order || loading) {
      setAutoOpenBlockedReason(null);
      return;
    }
    if (!capturedNwAppShippo) {
      setAutoOpenBlockedReason(null);
      return;
    }
    setAutoOpenBlockedReason(getNwAppShippoSkippedReason(capturedNwAppShippo, order));
  }, [order, loading, capturedNwAppShippo]);

  if (!orderId) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <p className="text-red-700">Invalid order.</p>
        <Link href="/seller-hub/orders" className="text-sm text-gray-600 hover:underline mt-4 inline-block">
          ← Back to orders
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (fetchError || !order) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <Link href="/seller-hub/orders" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to orders
        </Link>
        <div className="border rounded-lg p-6 bg-red-50">
          <p className="text-red-700">{fetchError ?? "Order not found."}</p>
        </div>
      </div>
    );
  }

  const orderLabel = order.orderNumber ?? order.id.slice(-8).toUpperCase();
  const buyerLine = `${order.buyer.firstName} ${order.buyer.lastName}`.trim();

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <Script src={SHIPPO_EMBEDDABLE_URL} strategy="afterInteractive" />

      <Link href="/seller-hub/orders" className="text-sm text-gray-600 hover:underline mb-2 inline-block">
        ← Back to orders
      </Link>
      <Link
        href={`/seller-hub/orders/${orderId}`}
        className="text-sm block mb-6 hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        View full order details
      </Link>

      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--color-heading)" }}>
        Shipping label
      </h1>
      <p className="text-sm text-gray-600 mb-1">
        Order #{orderLabel}
        {buyerLine ? ` · ${buyerLine}` : ""}
      </p>
      <p className="text-sm text-gray-500 mb-4">
        Choose a carrier in the popup and pay with your Shippo account. You can close this screen when you are done.
      </p>

      {autoOpenBlockedReason && capturedNwAppShippo ? (
        <div className="border rounded-lg p-4 bg-amber-50 text-amber-900 text-sm mb-4">
          <p className="font-medium mb-1">Label flow did not open automatically</p>
          <p>{autoOpenBlockedReason}</p>
          <p className="mt-2">
            <Link href={`/seller-hub/orders/${orderId}`} className="underline font-medium">
              Open full order
            </Link>{" "}
            to purchase or manage labels manually.
          </p>
        </div>
      ) : null}

      {elementsError ? <p className="text-sm text-amber-700 mb-3">{elementsError}</p> : null}

      {(() => {
        const canLabelFlow =
          order.status === "paid" ||
          order.status === "shipped" ||
          order.status === "delivered";
        return (
          <div className="flex flex-col gap-2">
            {order.status === "paid" && !order.shipment && (
              <button
                type="button"
                onClick={() => void openElementsFlow()}
                disabled={elementsLoading}
                className="btn text-sm py-2 px-4 disabled:opacity-50 w-full sm:w-auto"
              >
                {elementsLoading ? "Opening…" : "Purchase label"}
              </button>
            )}
            {canLabelFlow &&
              order.shipment?.shippoOrderId &&
              order.shipment.createdAt &&
              isWithinLabelReprintWindow(order.shipment.createdAt) && (
                <button
                  type="button"
                  onClick={() => void openElementsFlow({ forReprint: true })}
                  disabled={elementsLoading}
                  className="btn text-sm py-2 px-4 disabled:opacity-50 w-full sm:w-auto"
                >
                  {elementsLoading ? "Opening…" : "Reprint label"}
                </button>
              )}
            {canLabelFlow && order.shipment && (
              <button
                type="button"
                onClick={() => void openElementsFlow()}
                disabled={elementsLoading}
                className="btn text-sm py-2 px-4 disabled:opacity-50 w-full sm:w-auto"
              >
                {elementsLoading ? "Opening…" : "Purchase another label"}
              </button>
            )}
          </div>
        );
      })()}

      <ShippoElementsModal
        open={shippoModalOpen}
        onClose={closeShippoModal}
        containerId={SHIPPO_CONTAINER_ID_THIN}
        title="Shippo — label"
      />
    </div>
  );
}
