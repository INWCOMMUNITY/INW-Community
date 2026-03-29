"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import {
  buildOrderDetailsFromOrder,
  transactionToLabelFromElementsPayload,
  type ElementsTransactionPayload,
  type OrderForElements,
} from "@/lib/shippo-elements";
import { NWC_SHIPPO_ELEMENTS_THEME, type ShippoElementsTheme } from "@/lib/shippo-elements-theme";
import { isWithinLabelReprintWindow } from "@/lib/shippo-label-reprint";
import { notifyNwAppShippoLabelSuccess } from "@/lib/nw-app-webview-bridge";

export const SHIPPO_ORG = "inw-community";
export const SHIPPO_EMBEDDABLE_URL = "https://js.goshippo.com/embeddable-client.js";

type ShippoWidget = {
  init: (o: { token: string; org: string; theme?: ShippoElementsTheme }) => void;
  labelPurchase: (s: string, d: unknown) => void;
  on: (ev: string, cb: (arg: unknown) => void) => void;
};

function isShippoReady(shippo: ShippoWidget | undefined): shippo is ShippoWidget {
  return (
    shippo != null &&
    typeof shippo.init === "function" &&
    typeof shippo.labelPurchase === "function"
  );
}

function waitForShippo(): Promise<ShippoWidget | null> {
  return new Promise((resolve) => {
    const win = typeof window !== "undefined" ? (window as { shippo?: ShippoWidget }) : null;
    if (win?.shippo != null && isShippoReady(win.shippo)) {
      resolve(win.shippo);
      return;
    }
    let attempts = 0;
    const maxAttempts = 120;
    const interval = setInterval(() => {
      const w = typeof window !== "undefined" ? (window as { shippo?: ShippoWidget }) : null;
      if (w?.shippo != null && isShippoReady(w.shippo)) {
        clearInterval(interval);
        resolve(w.shippo);
        return;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

/** Store order shape required for Shippo Elements (matches GET /api/store-orders/[id]). */
export interface StoreOrderForShippo extends OrderForElements {
  id: string;
  orderNumber?: string;
  status: string;
  shipment?: {
    shippoOrderId?: string | null;
    createdAt?: string;
  } | null;
}

export type NwAppShippoMode = "reprint" | "purchase" | "another";

/**
 * Shippo Embeddable label purchase for a single store order. Register listeners once per widget instance.
 */
export function useShippoLabelFlowForOrder(options: {
  orderId: string;
  containerId: string;
  order: StoreOrderForShippo | null;
  orderLoading: boolean;
  onLabelSaved: () => void;
}): {
  elementsLoading: boolean;
  elementsError: string | null;
  shippoModalOpen: boolean;
  openElementsFlow: (opts?: { forReprint?: boolean }) => Promise<void>;
  closeShippoModal: () => void;
} {
  const { orderId, containerId, order, orderLoading, onLabelSaved } = options;

  const [elementsLoading, setElementsLoading] = useState(false);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const [shippoModalOpen, setShippoModalOpen] = useState(false);
  const elementsListenersRef = useRef(false);
  const shippoOrderIdFromCreatedRef = useRef<string | null>(null);
  const labelFlowOrderIdRef = useRef<string>("");
  const autoNwAppShippoTriggeredRef = useRef(false);
  const onLabelSavedRef = useRef(onLabelSaved);
  onLabelSavedRef.current = onLabelSaved;

  const openElementsFlow = useCallback(
    async (flowOpts: { forReprint?: boolean } = {}) => {
      if (!order || !orderId) return;
      labelFlowOrderIdRef.current = orderId;
      const objectId = flowOpts.forReprint ? order.shipment?.shippoOrderId : undefined;
      const orderDetails = buildOrderDetailsFromOrder(order, objectId, {
        freshShippoOrder: Boolean(order.shipment) && !flowOpts.forReprint,
      });
      if (!orderDetails) {
        setElementsError("Order has no valid shipping address.");
        return;
      }
      setElementsError(null);
      setElementsLoading(true);
      shippoOrderIdFromCreatedRef.current = null;
      try {
        const tokenRes = await fetch("/api/shipping/elements-token");
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok) {
          const code = (tokenData as { code?: string }).code;
          if (code === "SHIPPING_ACCOUNT_REQUIRED") {
            setElementsError("Connect your shipping account in shipping setup first.");
            return;
          }
          setElementsError((tokenData as { error?: string }).error ?? "Could not load Shippo widget.");
          return;
        }
        const token = (tokenData as { token?: string }).token;
        if (!token) {
          setElementsError("Could not get widget token.");
          return;
        }
        let shippo =
          typeof window !== "undefined" ? (window as { shippo?: ShippoWidget }).shippo : null;
        if (!shippo?.init || !shippo?.labelPurchase) {
          shippo = await waitForShippo();
          if (!shippo?.init || !shippo?.labelPurchase) {
            setElementsError(
              "Shippo could not load (the script may be blocked). Try a hard refresh, pause ad blockers for this site, or try another browser. If it persists, contact support."
            );
            return;
          }
        }
        shippo.init({ token, org: SHIPPO_ORG, theme: NWC_SHIPPO_ELEMENTS_THEME });
        if (!elementsListenersRef.current) {
          elementsListenersRef.current = true;
          shippo.on("ORDER_CREATED", (params: unknown) => {
            const p = params as { order_id?: string };
            if (p?.order_id) shippoOrderIdFromCreatedRef.current = p.order_id;
          });
          shippo.on("LABEL_PURCHASED_SUCCESS", async (transactions: unknown) => {
            const txs = Array.isArray(transactions) ? (transactions as ElementsTransactionPayload[]) : [];
            const saveOrderId = labelFlowOrderIdRef.current;
            if (txs.length === 0 || !saveOrderId) return;
            const firstTx = txs[0];
            const payload = transactionToLabelFromElementsPayload(firstTx, {
              weightOz: 16,
              lengthIn: 12,
              widthIn: 12,
              heightIn: 12,
            });
            const shippoOrderId =
              firstTx.order_id?.trim() || shippoOrderIdFromCreatedRef.current?.trim() || null;
            try {
              const res = await fetch("/api/shipping/label-from-elements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId: saveOrderId,
                  ...payload,
                  ...(shippoOrderId ? { shippoOrderId } : {}),
                }),
              });
              const saveData = await res.json().catch(() => ({}));
              if (res.ok) {
                onLabelSavedRef.current();
                notifyNwAppShippoLabelSuccess({ orderId: saveOrderId });
              } else {
                setElementsError(
                  typeof (saveData as { error?: string }).error === "string"
                    ? (saveData as { error: string }).error
                    : "Could not save label to your order. If you were charged, contact support with your order number."
                );
              }
            } catch {
              setElementsError("Could not save label to your order.");
            }
          });
          shippo.on("ERROR", (err: unknown) => {
            const msg =
              err && typeof err === "object" && "detail" in err
                ? String((err as { detail: string }).detail)
                : "Something went wrong.";
            setElementsError(msg);
          });
        }
        const mount = document.getElementById(containerId);
        if (mount) mount.innerHTML = "";
        flushSync(() => {
          setShippoModalOpen(true);
        });
        shippo.labelPurchase(`#${containerId}`, orderDetails);
      } catch {
        setElementsError("Connection failed.");
      } finally {
        setElementsLoading(false);
      }
    },
    [order, orderId, containerId]
  );

  const closeShippoModal = useCallback(() => {
    setShippoModalOpen(false);
  }, []);

  const openElementsFlowRef = useRef(openElementsFlow);
  openElementsFlowRef.current = openElementsFlow;

  useEffect(() => {
    if (typeof window === "undefined" || !order || orderLoading || !orderId) return;
    if (autoNwAppShippoTriggeredRef.current) return;
    const sp = new URLSearchParams(window.location.search);
    const mode = sp.get("nwAppShippo") ?? sp.get("labelAction");
    if (!mode) return;
    if (mode !== "reprint" && mode !== "purchase" && mode !== "another") return;
    autoNwAppShippoTriggeredRef.current = true;
    sp.delete("nwAppShippo");
    sp.delete("labelAction");
    sp.delete("nwAppChrome");
    const qs = sp.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
    );

    const run = openElementsFlowRef.current;
    const canReprintStatus =
      order.status === "paid" ||
      order.status === "shipped" ||
      order.status === "delivered";
    if (mode === "reprint") {
      if (
        canReprintStatus &&
        order.shipment?.shippoOrderId &&
        order.shipment.createdAt &&
        isWithinLabelReprintWindow(order.shipment.createdAt)
      ) {
        void run({ forReprint: true });
      }
    } else if (mode === "purchase") {
      if (order.status === "paid" && !order.shipment) {
        void run();
      }
    } else if (mode === "another") {
      const canAnother =
        order.shipment &&
        (order.status === "paid" ||
          order.status === "shipped" ||
          order.status === "delivered");
      if (canAnother) {
        void run();
      }
    }
  }, [order, orderLoading, orderId]);

  return {
    elementsLoading,
    elementsError,
    shippoModalOpen,
    openElementsFlow,
    closeShippoModal,
  };
}

/**
 * Human-readable reason when nwAppShippo auto-open did not run (for thin label page UX).
 */
export function getNwAppShippoSkippedReason(
  mode: NwAppShippoMode | null,
  order: StoreOrderForShippo | null
): string | null {
  if (!mode || !order) return null;
  if (mode === "reprint") {
    if (order.status !== "paid" && order.status !== "shipped" && order.status !== "delivered") {
      return "Reprint is only available for paid or shipped orders with a label on file.";
    }
    if (!order.shipment?.shippoOrderId) return "No Shippo order on file to reprint.";
    if (!order.shipment.createdAt || !isWithinLabelReprintWindow(order.shipment.createdAt)) {
      return "Reprint is only available within 24 hours of purchasing the label.";
    }
    return null;
  }
  if (mode === "purchase") {
    if (order.status !== "paid") return "Order must be paid before purchasing a label.";
    if (order.shipment) return "This order already has a shipment. Use “Purchase another label” from order details if needed.";
    return null;
  }
  if (mode === "another") {
    if (!order.shipment) return "Purchase a first label from order details before purchasing another.";
    if (
      order.status !== "paid" &&
      order.status !== "shipped" &&
      order.status !== "delivered"
    ) {
      return "Purchase another label is only available for paid, shipped, or delivered orders.";
    }
    return null;
  }
  return null;
}

/** Read nwAppShippo from current URL without consuming it (for messaging before strip runs in hook). */
export function readNwAppShippoModeFromWindow(): NwAppShippoMode | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const m = sp.get("nwAppShippo") ?? sp.get("labelAction");
  if (m === "reprint" || m === "purchase" || m === "another") return m;
  return null;
}
