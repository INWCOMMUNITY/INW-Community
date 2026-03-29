"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import {
  buildOrderDetailsFromOrder,
  transactionToLabelFromElementsPayload,
  type ElementsTransactionPayload,
} from "@/lib/shippo-elements";
import { NWC_SHIPPO_ELEMENTS_THEME, type ShippoElementsTheme } from "@/lib/shippo-elements-theme";
import { notifyNwAppShippoLabelSuccess } from "@/lib/nw-app-webview-bridge";
import { afterNextPaint, clearShippoElementsMount } from "@/lib/shippo-mount-utils";

export const SHIPPO_BULK_ORG = "inw-community";
export const SHIPPO_BULK_EMBEDDABLE_URL = "https://js.goshippo.com/embeddable-client.js";

const DEFAULT_WEIGHT_OZ = 16;
const DEFAULT_LENGTH_IN = 12;
const DEFAULT_WIDTH_IN = 12;
const DEFAULT_HEIGHT_IN = 12;

interface ShippoElementsAPI {
  init: (opts: { token: string; org: string; theme?: ShippoElementsTheme }) => void;
  labelPurchase: (selector: string, orderDetails: unknown) => void;
  on: (event: string, callback: (arg: unknown) => void) => void;
}

function isShippoReady(shippo: ShippoElementsAPI | undefined): shippo is ShippoElementsAPI {
  return (
    shippo != null &&
    typeof shippo.init === "function" &&
    typeof shippo.labelPurchase === "function"
  );
}

function waitForShippo(): Promise<ShippoElementsAPI | null> {
  return new Promise((resolve) => {
    const win = typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }) : null;
    if (win?.shippo != null && isShippoReady(win.shippo)) {
      resolve(win.shippo);
      return;
    }
    let attempts = 0;
    const maxAttempts = 120;
    const interval = setInterval(() => {
      const w = typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }) : null;
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

export interface StoreOrderForBulkLabel {
  id: string;
  orderNumber?: string;
  orderKind?: string;
  totalCents?: number;
  status: string;
  shippingAddress: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: Array<{
    storeItem: { title: string };
    quantity: number;
    priceCentsAtPurchase: number;
  }>;
  shipment?: {
    shippoOrderId?: string | null;
    createdAt?: string;
  } | null;
  shippedWithOrderId?: string;
}

/**
 * Partition to-ship orders so each group shares one buyer email (API requirement for combined save).
 * Orders with no email never merge with others.
 */
export function groupToShipOrdersByBuyer<T extends { id: string; buyer: { email?: string } }>(orders: T[]): T[][] {
  const map = new Map<string, T[]>();
  for (const o of orders) {
    const email = o.buyer?.email?.trim().toLowerCase();
    const key = email && email.length > 0 ? email : `__anon__:${o.id}`;
    const list = map.get(key);
    if (list) list.push(o);
    else map.set(key, [o]);
  }
  return Array.from(map.values());
}

export function isOrderEligibleForBulkShip(o: StoreOrderForBulkLabel): boolean {
  return (
    o.status === "paid" && !o.shipment && !(o as { shippedWithOrderId?: string }).shippedWithOrderId
  );
}

function buildBulkOrderDetails(selectedOrders: StoreOrderForBulkLabel[]) {
  const orderDetailsArray: NonNullable<ReturnType<typeof buildOrderDetailsFromOrder>>[] = [];
  for (const o of selectedOrders) {
    const one = buildOrderDetailsFromOrder(o, undefined, {
      freshShippoOrder: Boolean(o.shipment),
    });
    if (!one) return null;
    orderDetailsArray.push(one);
  }
  return orderDetailsArray.length === 1 ? orderDetailsArray[0] : orderDetailsArray;
}

export function useShippoBulkLabelFlow(options: {
  containerId: string;
  orders: StoreOrderForBulkLabel[];
  onAfterSave: () => void;
}) {
  const { containerId, orders, onAfterSave } = options;

  const [elementsLoading, setElementsLoading] = useState(false);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const [shippoSurfaceOpen, setShippoSurfaceOpen] = useState(false);
  const [progressSubtitle, setProgressSubtitle] = useState<string | null>(null);

  const elementsListenersRef = useRef(false);
  const currentElementsOrderIdsRef = useRef<string[]>([]);
  const shippoOrderIdsRef = useRef<string[]>([]);
  const buyerGroupsRef = useRef<StoreOrderForBulkLabel[][]>([]);
  const groupIndexRef = useRef(0);
  const sessionLabeledOrderIdsRef = useRef<string[]>([]);
  const labelSuccessHandlingRef = useRef(false);
  /** Ignores stale `LABEL_PURCHASED_SUCCESS` when another flow/hook also registered on `window.shippo`. */
  const bulkFlowActiveRef = useRef(false);
  const onAfterSaveRef = useRef(onAfterSave);
  onAfterSaveRef.current = onAfterSave;

  const containerIdRef = useRef(containerId);
  containerIdRef.current = containerId;

  useEffect(() => {
    return () => {
      bulkFlowActiveRef.current = false;
      labelSuccessHandlingRef.current = false;
      clearShippoElementsMount(containerIdRef.current);
    };
  }, []);

  const advanceOrFinish = useCallback(async (shippo: ShippoElementsAPI, afterSaveOrderIds: string[]) => {
    const cid = containerIdRef.current;
    sessionLabeledOrderIdsRef.current = [...sessionLabeledOrderIdsRef.current, ...afterSaveOrderIds];
    onAfterSaveRef.current();

    const groups = buyerGroupsRef.current;
    const nextIdx = groupIndexRef.current + 1;
    if (nextIdx >= groups.length) {
      notifyNwAppShippoLabelSuccess({ orderIds: sessionLabeledOrderIdsRef.current });
      setProgressSubtitle(null);
      bulkFlowActiveRef.current = false;
      clearShippoElementsMount(containerIdRef.current);
      setShippoSurfaceOpen(false);
      buyerGroupsRef.current = [];
      groupIndexRef.current = 0;
      sessionLabeledOrderIdsRef.current = [];
      return;
    }

    const nextGroup = groups[nextIdx];
    const orderDetails = buildBulkOrderDetails(nextGroup);
    if (!orderDetails) {
      setElementsError("Order(s) have no valid shipping address.");
      setProgressSubtitle(null);
      bulkFlowActiveRef.current = false;
      clearShippoElementsMount(containerIdRef.current);
      setShippoSurfaceOpen(false);
      buyerGroupsRef.current = [];
      groupIndexRef.current = 0;
      sessionLabeledOrderIdsRef.current = [];
      return;
    }

    groupIndexRef.current = nextIdx;
    setProgressSubtitle(groups.length > 1 ? `Buyer ${nextIdx + 1} of ${groups.length}` : null);
    currentElementsOrderIdsRef.current = nextGroup.map((o) => o.id);
    shippoOrderIdsRef.current = [];
    clearShippoElementsMount(cid);
    flushSync(() => {
      setShippoSurfaceOpen(true);
    });
    await afterNextPaint();
    const mount = document.getElementById(cid);
    if (!mount) {
      setElementsError("Label tool could not open. Close and try again.");
      bulkFlowActiveRef.current = false;
      setShippoSurfaceOpen(false);
      return;
    }
    bulkFlowActiveRef.current = true;
    shippo.labelPurchase(`#${cid}`, orderDetails);
  }, []);

  const advanceOrFinishRef = useRef(advanceOrFinish);
  advanceOrFinishRef.current = advanceOrFinish;

  const runBulkFlow = useCallback(async (orderIds: string[]) => {
    const idSet = new Set(orderIds.map((id) => id.trim()).filter(Boolean));
    if (idSet.size === 0) {
      setElementsError("Select at least one order.");
      return;
    }

    const eligible = orders.filter(isOrderEligibleForBulkShip);
    const eligibleById = new Map(eligible.map((o) => [o.id, o]));
    const selected: StoreOrderForBulkLabel[] = [];
    for (const id of idSet) {
      const o = eligibleById.get(id);
      if (!o) {
        setElementsError("One or more selected orders are not available to ship. Refresh the list.");
        return;
      }
      selected.push(o);
    }

    const groups = groupToShipOrdersByBuyer(selected);
    buyerGroupsRef.current = groups;
    groupIndexRef.current = 0;
    sessionLabeledOrderIdsRef.current = [];

    const first = groups[0];
    const orderDetails = buildBulkOrderDetails(first);
    if (!orderDetails) {
      setElementsError("Selected order(s) have no valid shipping address.");
      return;
    }

    setElementsError(null);
    setElementsLoading(true);
    try {
      const tokenRes = await fetch("/api/shipping/elements-token");
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        const code = (tokenData as { code?: string }).code;
        if (code === "SHIPPING_ACCOUNT_REQUIRED") {
          setElementsError("Connect your shipping account in shipping setup first.");
          return;
        }
        setElementsError((tokenData as { error?: string }).error ?? "Could not load Shippo.");
        return;
      }
      const token = (tokenData as { token?: string }).token;
      if (!token) {
        setElementsError("Could not get widget token.");
        return;
      }

      let shippo = typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }).shippo : null;
      if (!shippo?.init || !shippo?.labelPurchase) {
        shippo = await waitForShippo();
        if (!shippo?.init || !shippo?.labelPurchase) {
          setElementsError(
            "Shippo could not load (the script may be blocked). Try a hard refresh, pause ad blockers for this site, or try another browser. If it persists, contact support."
          );
          return;
        }
      }

      shippo.init({ token, org: SHIPPO_BULK_ORG, theme: NWC_SHIPPO_ELEMENTS_THEME });
      currentElementsOrderIdsRef.current = first.map((o) => o.id);
      shippoOrderIdsRef.current = [];

      if (!elementsListenersRef.current) {
        elementsListenersRef.current = true;
        shippo.on("ORDER_CREATED", (params: unknown) => {
          if (!bulkFlowActiveRef.current) return;
          const p = params as { order_id?: string };
          if (p?.order_id) shippoOrderIdsRef.current.push(p.order_id);
        });
        shippo.on("LABEL_PURCHASED_SUCCESS", async (transactions: unknown) => {
          if (!bulkFlowActiveRef.current) return;
          if (labelSuccessHandlingRef.current) return;
          const txs = Array.isArray(transactions) ? (transactions as ElementsTransactionPayload[]) : [];
          const labeledOrderIds = currentElementsOrderIdsRef.current;
          if (labeledOrderIds.length === 0 || txs.length === 0) return;
          labelSuccessHandlingRef.current = true;
          const firstTx = txs[0] as ElementsTransactionPayload;
          const payload = transactionToLabelFromElementsPayload(firstTx, {
            weightOz: DEFAULT_WEIGHT_OZ,
            lengthIn: DEFAULT_LENGTH_IN,
            widthIn: DEFAULT_WIDTH_IN,
            heightIn: DEFAULT_HEIGHT_IN,
          });
          const shippoOrderId =
            firstTx.order_id?.trim() || shippoOrderIdsRef.current[0]?.trim() || null;
          try {
            const res = await fetch("/api/shipping/label-from-elements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderIds: labeledOrderIds,
                ...payload,
                ...(shippoOrderId ? { shippoOrderId } : {}),
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              let shippoNow =
                typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }).shippo : null;
              shippoNow = shippoNow && isShippoReady(shippoNow) ? shippoNow : null;
              if (!shippoNow) {
                shippoNow = await waitForShippo();
              }
              if (shippoNow && isShippoReady(shippoNow)) {
                await advanceOrFinishRef.current(shippoNow, labeledOrderIds);
              } else {
                setElementsError(
                  "Label saved, but the app could not open the next step. Refresh this page and check your orders."
                );
                bulkFlowActiveRef.current = false;
                clearShippoElementsMount(containerIdRef.current);
                setShippoSurfaceOpen(false);
                setProgressSubtitle(null);
                buyerGroupsRef.current = [];
                groupIndexRef.current = 0;
                sessionLabeledOrderIdsRef.current = [];
              }
            } else {
              setElementsError(
                typeof (data as { error?: string }).error === "string"
                  ? (data as { error: string }).error
                  : "Could not save label to your order. If you were charged, contact support with your order number."
              );
            }
          } catch {
            setElementsError("Could not save label to your order.");
          } finally {
            labelSuccessHandlingRef.current = false;
          }
        });
        shippo.on("ERROR", (err: unknown) => {
          if (!bulkFlowActiveRef.current) return;
          const msg =
            err && typeof err === "object" && "detail" in err
              ? String((err as { detail: string }).detail)
              : "Something went wrong.";
          setElementsError(msg);
        });
      }

      setProgressSubtitle(groups.length > 1 ? `Buyer 1 of ${groups.length}` : null);
      clearShippoElementsMount(containerIdRef.current);
      flushSync(() => {
        setShippoSurfaceOpen(true);
      });
      await afterNextPaint();
      const mount = document.getElementById(containerIdRef.current);
      if (!mount) {
        setElementsError("Label tool could not open. Close and try again.");
        bulkFlowActiveRef.current = false;
        setShippoSurfaceOpen(false);
        return;
      }
      bulkFlowActiveRef.current = true;
      shippo.labelPurchase(`#${containerIdRef.current}`, orderDetails);
    } catch {
      setElementsError("Connection failed.");
    } finally {
      setElementsLoading(false);
    }
  }, [orders]);

  const closeShippoSurface = useCallback(() => {
    bulkFlowActiveRef.current = false;
    labelSuccessHandlingRef.current = false;
    clearShippoElementsMount(containerIdRef.current);
    setShippoSurfaceOpen(false);
    setProgressSubtitle(null);
    buyerGroupsRef.current = [];
    groupIndexRef.current = 0;
    sessionLabeledOrderIdsRef.current = [];
  }, []);

  return {
    elementsLoading,
    elementsError,
    setElementsError,
    shippoSurfaceOpen,
    closeShippoSurface,
    runBulkFlow,
    progressSubtitle,
  };
}
