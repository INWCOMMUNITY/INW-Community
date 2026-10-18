"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { useParams } from "next/navigation";
import { ShippoElementsSurface, ShippoPrintLabelActions } from "@/components/ShippoElementsModal";
import {
  useShippoLabelFlowForOrder,
  SHIPPO_EMBEDDABLE_URL,
  getNwAppShippoSkippedReason,
  type StoreOrderForShippo,
} from "@/hooks/use-shippo-label-flow-for-order";
import { orderEligibleForAnotherShippoLabel } from "types";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";
import { sellerMustChooseReturnRefundTiming } from "@/lib/return-refund-timing";
import { ReturnLabelDueTag, SellerReturnRefundChoiceModal } from "@/components/seller/SellerReturnRefundChoice";

const SHIPPO_CONTAINER_ID_THIN = "shippo-elements-container-order-thin";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  fulfillmentType?: string | null;
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
  localDeliveryDetails?: unknown;
  storeReturn?: { status?: string | null } | null;
  returnShipment?: { labelUrl?: string | null } | null;
}

export default function SellerShippoThinLabelPage() {
  const params = useParams();
  const rawOrderId = params?.orderId;
  const orderId =
    typeof rawOrderId === "string" ? rawOrderId : Array.isArray(rawOrderId) ? (rawOrderId[0] ?? "") : "";

  /** Capture deep-link chrome once; label mode is kept by the Shippo hook after the query is stripped. */
  const nwAppChromeCaptureRef = useRef<boolean | undefined>(undefined);
  if (typeof window !== "undefined" && nwAppChromeCaptureRef.current === undefined) {
    try {
      nwAppChromeCaptureRef.current =
        new URLSearchParams(window.location.search).get("nwAppChrome") === "1";
    } catch {
      nwAppChromeCaptureRef.current = false;
    }
  }
  const embeddedNwAppChrome = nwAppChromeCaptureRef.current ?? false;

  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [autoOpenBlockedReason, setAutoOpenBlockedReason] = useState<string | null>(null);
  const [labelJustSent, setLabelJustSent] = useState(false);
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);

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

  const labelModeRef = useRef<"reprint" | "purchase" | "another" | "return" | null>(null);

  const {
    elementsLoading,
    elementsError,
    shippoModalOpen,
    purchasedLabelUrls,
    deepLinkMode,
    openElementsFlow,
    closeShippoModal,
  } = useShippoLabelFlowForOrder({
    orderId,
    containerId: SHIPPO_CONTAINER_ID_THIN,
    order,
    orderLoading: loading,
    onLabelSaved: () => {
      refetchOrder();
      if (labelModeRef.current === "return") setLabelJustSent(true);
    },
  });
  labelModeRef.current = deepLinkMode;
  const capturedNwAppShippo = deepLinkMode;

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

  async function chooseRefundTiming(timing: "now" | "on_arrival") {
    if (!orderId) return;
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
      setLabelJustSent(false);
      refetchOrder();
    } catch {
      setChoiceError("Connection failed.");
    } finally {
      setChoiceBusy(false);
    }
  }

  if (!orderId) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <p className="text-red-700">Invalid order.</p>
        <Link href="/seller-hub/orders" className="text-sm text-gray-600 hover:underline mt-4 inline-block">
          ← Back to Orders
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
          ← Back to Orders
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
    <div className={`mx-auto px-4 py-6 ${embeddedNwAppChrome ? "max-w-none min-h-[100dvh]" : "max-w-lg"}`}>
      <Script src={SHIPPO_EMBEDDABLE_URL} strategy="afterInteractive" />

      {!embeddedNwAppChrome ? (
        <>
          <Link href="/seller-hub/orders" className="text-sm text-gray-600 hover:underline mb-2 inline-block">
            ← Back to Orders
          </Link>
          <Link
            href={`/seller-hub/orders/${orderId}`}
            className="text-sm block mb-6 hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            View Order
          </Link>
        </>
      ) : null}

      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--color-heading)" }}>
        {capturedNwAppShippo === "return"
          ? "Send Buyer Return Label"
          : capturedNwAppShippo === "reprint"
            ? "Reprint Label"
            : capturedNwAppShippo === "another" || (!capturedNwAppShippo && order.shipment)
              ? "Repurchase Shipping Label"
              : "Buy Shipping Label"}
      </h1>
      <p className="text-sm text-gray-600 mb-1">
        Order #{orderLabel}
        {buyerLine ? ` · ${buyerLine}` : ""}
      </p>
      <p className="text-sm text-gray-500 mb-4">
        {capturedNwAppShippo === "return"
          ? "Shippo opens with the buyer’s checkout address as the sender and your default ship-from as the destination. Choose a carrier and buy the label on your Shippo account."
          : embeddedNwAppChrome
            ? "Choose a carrier and complete purchase in Shippo below. Use the arrow to close when finished."
            : "Opens the label tool on this page: choose a carrier, pay with your Shippo account, then print or download. Tap Close when you are done."}
      </p>

      {autoOpenBlockedReason && capturedNwAppShippo ? (
        <div className="border rounded-lg p-4 bg-amber-50 text-amber-900 text-sm mb-4">
          <p className="font-medium mb-1">Label checkout did not open automatically</p>
          <p>{autoOpenBlockedReason}</p>
          {!embeddedNwAppChrome ? (
            <p className="mt-2">
              <Link href={`/seller-hub/orders/${orderId}`} className="underline font-medium">
                Open full order
              </Link>{" "}
              to purchase or manage labels manually.
            </p>
          ) : (
            <p className="mt-2">Use the button below to open Shippo and buy a label for this address.</p>
          )}
        </div>
      ) : null}

      {elementsError ? <p className="text-sm text-amber-700 mb-3">{elementsError}</p> : null}

      <div className="flex flex-col gap-2">
            {capturedNwAppShippo !== "return" && order.shipment?.labelUrl ? (
              <a
                href={order.shipment.labelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn text-sm py-2 px-4 w-full sm:w-auto"
              >
                Reprint Label
              </a>
            ) : null}
            {capturedNwAppShippo !== "return" &&
            order.status === "paid" &&
            !order.shipment &&
            orderHasShippedLine(order.items) ? (
              <button
                type="button"
                onClick={() => void openElementsFlow()}
                disabled={elementsLoading}
                className="btn text-sm py-2 px-4 disabled:opacity-50 w-full sm:w-auto"
              >
                {elementsLoading ? "Opening…" : "Purchase Label"}
              </button>
            ) : null}
            {capturedNwAppShippo !== "return" && orderEligibleForAnotherShippoLabel(order) ? (
              <button
                type="button"
                onClick={() => void openElementsFlow({ forceAdditionalLabel: true })}
                disabled={elementsLoading}
                className="btn text-sm py-2 px-4 disabled:opacity-50 w-full sm:w-auto"
              >
                {elementsLoading ? "Opening…" : "Repurchase Label"}
              </button>
            ) : null}
            {capturedNwAppShippo === "return" && !order.returnShipment?.labelUrl ? (
              <div className="flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void openElementsFlow({ forReturn: true })}
                  disabled={elementsLoading}
                  className="btn text-sm py-2 px-4 disabled:opacity-50 w-full"
                >
                  {elementsLoading ? "Opening…" : "Send Buyer Return Label"}
                </button>
                <ReturnLabelDueTag />
              </div>
            ) : null}
      </div>

      <SellerReturnRefundChoiceModal
        open={labelJustSent || sellerMustChooseReturnRefundTiming(order)}
        busy={choiceBusy}
        error={choiceError}
        onRefundNow={() => void chooseRefundTiming("now")}
        onRefundWhenArrives={() => void chooseRefundTiming("on_arrival")}
      />

      <ShippoElementsSurface
        open={shippoModalOpen}
        onClose={closeShippoModal}
        containerId={SHIPPO_CONTAINER_ID_THIN}
        title={capturedNwAppShippo === "return" ? "Send Buyer Return Label" : "Shippo — Labels"}
        presentation="page"
        actions={<ShippoPrintLabelActions urls={purchasedLabelUrls} />}
      />
    </div>
  );
}
