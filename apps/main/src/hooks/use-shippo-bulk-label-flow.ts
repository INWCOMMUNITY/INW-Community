"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import {
  buildCombinedOrderDetails,
  buildOrderDetailsFromOrder,
  collectLabelUrlsFromTransactions,
  ordersCanCombineShipping,
  openLabelPdfUrls,
  parcelFromOrderItems,
  resolvePostalShipToAddress,
  transactionToLabelFromElementsPayload,
  uniqueHttpUrls,
  type ElementsTransactionPayload,
  type OrderForElements,
} from "@/lib/shippo-elements";
import { NWC_SHIPPO_ELEMENTS_THEME, type ShippoElementsTheme } from "@/lib/shippo-elements-theme";
import { notifyNwAppShippoLabelSuccess } from "@/lib/nw-app-webview-bridge";
import { afterNextPaint, clearShippoElementsMount } from "@/lib/shippo-mount-utils";
import { orderHasShippedLine } from "@/lib/store-order-fulfillment";

export const SHIPPO_BULK_ORG = "inw-community";
export const SHIPPO_BULK_EMBEDDABLE_URL = "https://js.goshippo.com/embeddable-client.js";

const DEFAULT_WEIGHT_OZ = 16;
const DEFAULT_LENGTH_IN = 12;
const DEFAULT_WIDTH_IN = 12;
const DEFAULT_HEIGHT_IN = 12;

function combinedParcelForOrders(orders: OrderForElements[]) {
  return parcelFromOrderItems({
    id: "bulk",
    shippingAddress: null,
    buyer: { firstName: "", lastName: "" },
    items: orders.flatMap((o) =>
      o.items.map((item) => ({
        storeItem: {
          title: item.storeItem?.title ?? "Item",
          shippingOption: item.storeItem?.shippingOption,
        },
        quantity: item.quantity,
        priceCentsAtPurchase: item.priceCentsAtPurchase,
      }))
    ),
  });
}

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
  localDeliveryDetails?: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: Array<{
    storeItem: { title: string };
    quantity: number;
    priceCentsAtPurchase: number;
    fulfillmentType?: string | null;
  }>;
  shipment?: {
    shippoOrderId?: string | null;
    createdAt?: string;
    labelUrl?: string | null;
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

export type BulkShipGroup = { orderIds: string[]; combine: boolean };

/** Fully selected combined boxes first, then any remaining orders as their own labels. */
export function purchaseGroupsForSelection(selectedIds: string[], combinedGroups: string[][]): BulkShipGroup[] {
  const selected = new Set(selectedIds);
  const consumed = new Set<string>();
  const groups: BulkShipGroup[] = [];
  for (const group of combinedGroups) {
    if (group.length >= 2 && group.every((id) => selected.has(id))) {
      groups.push({ orderIds: group, combine: true });
      group.forEach((id) => consumed.add(id));
    }
  }
  for (const id of selectedIds) {
    if (!consumed.has(id)) groups.push({ orderIds: [id], combine: false });
  }
  return groups;
}

/** Decode a combined-group query that may still contain `%7C` / `%7c` after one URL decode. */
function decodeCombinedParam(raw: string): string {
  let value = raw.trim();
  for (let i = 0; i < 2 && value.includes("%"); i++) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value;
}

export function parseCombinedOrderGroups(raw: string | null): string[][] {
  if (!raw?.trim()) return [];
  return decodeCombinedParam(raw)
    .split(",")
    .map((part) => part.split(/[|~]/).map((id) => id.trim()).filter(Boolean))
    .filter((group) => group.length >= 2);
}

export function isOrderEligibleForBulkShip(o: StoreOrderForBulkLabel): boolean {
  return (
    o.status === "paid" &&
    !o.shipment &&
    !(o as { shippedWithOrderId?: string }).shippedWithOrderId &&
    orderHasShippedLine(o.items)
  );
}

/**
 * One Shippo order. An array argument to labelPurchase is bulk mode: one package per order.
 * A combined box is a single object with one line item. Anything else is one order at a time.
 */
function buildBulkOrderDetails(selectedOrders: StoreOrderForBulkLabel[], combine: boolean) {
  if (selectedOrders.length > 1) {
    if (!combine) return null;
    const combined = buildCombinedOrderDetails(selectedOrders);
    if (!combined || Array.isArray(combined) || combined.line_items.length !== 1) return null;
    return combined;
  }
  const order = selectedOrders[0];
  if (!order) return null;
  return buildOrderDetailsFromOrder(order, undefined, {
    freshShippoOrder: Boolean(order.shipment),
  });
}

function singleShippoOrder(details: ReturnType<typeof buildBulkOrderDetails>) {
  if (!details || Array.isArray(details)) return null;
  return details;
}

/**
 * Payload for one labelPurchase call.
 * An array, or an object_id, makes Shippo list every matching order. A combined box is
 * one new order object with one line item and no previously saved Shippo id.
 */
function payloadForLabelPurchase(
  orders: StoreOrderForBulkLabel[],
  combine: boolean
): { address_to: unknown; line_items: unknown[]; order_number?: string } | null {
  const details = singleShippoOrder(buildBulkOrderDetails(orders, combine));
  if (!details || details.line_items.length === 0) return null;
  if (combine && (orders.length < 2 || details.line_items.length !== 1)) return null;
  return {
    address_to: details.address_to,
    line_items: details.line_items.slice(0, combine ? 1 : details.line_items.length),
    ...(details.order_number ? { order_number: details.order_number } : {}),
  };
}

export type ShippoLabelSessionResult = {
  orderIds: string[];
  labelUrls: string[];
};

export function useShippoBulkLabelFlow(options: {
  containerId: string;
  orders: StoreOrderForBulkLabel[];
  onAfterSave: () => void;
  /** Fired after the last buyer group is saved. Shippo stays open so the seller can print. */
  onSessionComplete?: (result: ShippoLabelSessionResult) => void;
  /** Fired after the seller closes the Shippo surface (X or Shippo’s close). */
  onDismiss?: () => void;
}) {
  const { containerId, orders, onAfterSave, onSessionComplete, onDismiss } = options;

  const [elementsLoading, setElementsLoading] = useState(false);
  const [elementsError, setElementsError] = useState<string | null>(null);
  const [shippoSurfaceOpen, setShippoSurfaceOpen] = useState(false);
  const [progressSubtitle, setProgressSubtitle] = useState<string | null>(null);
  const [purchasedLabelUrls, setPurchasedLabelUrls] = useState<string[]>([]);

  const elementsListenersRef = useRef(false);
  const currentElementsOrderIdsRef = useRef<string[]>([]);
  const currentShipToSnapshotRef = useRef<ReturnType<typeof resolvePostalShipToAddress>>(null);
  const currentParcelRef = useRef<ReturnType<typeof parcelFromOrderItems>>(null);
  const shippoOrderIdsRef = useRef<string[]>([]);
  const buyerGroupsRef = useRef<StoreOrderForBulkLabel[][]>([]);
  const combineFlagsRef = useRef<boolean[]>([]);
  const groupIndexRef = useRef(0);
  const sessionLabeledOrderIdsRef = useRef<string[]>([]);
  const labelSuccessHandlingRef = useRef(false);
  /** Ignores stale `LABEL_PURCHASED_SUCCESS` when another flow/hook also registered on `window.shippo`. */
  const bulkFlowActiveRef = useRef(false);
  const sessionCompleteRef = useRef(false);
  const purchasedLabelUrlsRef = useRef<string[]>([]);
  const onAfterSaveRef = useRef(onAfterSave);
  onAfterSaveRef.current = onAfterSave;
  const onSessionCompleteRef = useRef(onSessionComplete);
  onSessionCompleteRef.current = onSessionComplete;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const closeShippoSurfaceRef = useRef<() => void>(() => {});

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
      sessionCompleteRef.current = true;
      bulkFlowActiveRef.current = false;
      setProgressSubtitle(
        purchasedLabelUrlsRef.current.length > 0
          ? "Label purchased — print it now, then close."
          : "Label purchased. Close when you are done."
      );
      onSessionCompleteRef.current?.({
        orderIds: sessionLabeledOrderIdsRef.current,
        labelUrls: purchasedLabelUrlsRef.current,
      });
      return;
    }

    const nextGroup = groups[nextIdx];
    const nextCombine = combineFlagsRef.current[nextIdx] === true;
    const orderDetails = payloadForLabelPurchase(nextGroup, nextCombine);
    if (!orderDetails) {
      sessionCompleteRef.current = true;
      bulkFlowActiveRef.current = false;
      setElementsError("Some labels were purchased, but the next shipment could not be opened as one package.");
      setProgressSubtitle(
        purchasedLabelUrlsRef.current.length > 0
          ? "Print the labels you bought, then close. Remaining orders need a shipping address."
          : null
      );
      onSessionCompleteRef.current?.({
        orderIds: sessionLabeledOrderIdsRef.current,
        labelUrls: purchasedLabelUrlsRef.current,
      });
      return;
    }

    groupIndexRef.current = nextIdx;
    setProgressSubtitle(
      nextCombine
        ? `One label for ${nextGroup.length} orders`
        : groups.length > 1
          ? `Buyer ${nextIdx + 1} of ${groups.length}`
          : null
    );
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
    currentShipToSnapshotRef.current = resolvePostalShipToAddress(nextGroup[0]);
    currentParcelRef.current = combinedParcelForOrders(nextGroup);
    shippo.labelPurchase(`#${cid}`, orderDetails);
  }, []);

  const advanceOrFinishRef = useRef(advanceOrFinish);
  advanceOrFinishRef.current = advanceOrFinish;

  const runBulkFlow = useCallback(async (
    orderIds: string[],
    options?: { combine?: boolean; groups?: BulkShipGroup[] }
  ) => {
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

    const resolved: { orders: StoreOrderForBulkLabel[]; combine: boolean }[] = [];
    if (options?.groups && options.groups.length > 0) {
      const byId = new Map(selected.map((order) => [order.id, order]));
      const used = new Set<string>();
      for (const group of options.groups) {
        const members = group.orderIds
          .map((id) => byId.get(id))
          .filter((order): order is StoreOrderForBulkLabel => Boolean(order));
        if (members.length === 0) continue;
        members.forEach((order) => used.add(order.id));
        if (group.combine && members.length > 1) {
          if (!ordersCanCombineShipping(members)) {
            setElementsError(
              "Combined orders must be from the same person and the same address."
            );
            return;
          }
          resolved.push({ orders: members, combine: true });
        } else {
          resolved.push({ orders: members, combine: false });
        }
      }
      const rest = selected.filter((order) => !used.has(order.id));
      for (const buyerGroup of groupToShipOrdersByBuyer(rest)) {
        resolved.push({ orders: buyerGroup, combine: false });
      }
    } else if (options?.combine === true) {
      if (!ordersCanCombineShipping(selected)) {
        setElementsError(
          "Combine shipping needs two or more orders from the same person going to the same address."
        );
        return;
      }
      resolved.push({ orders: selected, combine: true });
    } else {
      for (const buyerGroup of groupToShipOrdersByBuyer(selected)) {
        resolved.push({ orders: buyerGroup, combine: false });
      }
    }
    if (resolved.length === 0) {
      setElementsError("Select at least one order.");
      return;
    }
    const opened: { orders: StoreOrderForBulkLabel[]; combine: boolean }[] = [];
    for (const group of resolved) {
      if (group.combine && group.orders.length > 1) {
        opened.push(group);
        continue;
      }
      for (const order of group.orders) opened.push({ orders: [order], combine: false });
    }
    const groups = opened.map((group) => group.orders);
    combineFlagsRef.current = opened.map((group) => group.combine);
    buyerGroupsRef.current = groups;
    groupIndexRef.current = 0;
    sessionLabeledOrderIdsRef.current = [];
    sessionCompleteRef.current = false;
    purchasedLabelUrlsRef.current = [];
    setPurchasedLabelUrls([]);

    const first = groups[0];
    const firstCombine = combineFlagsRef.current[0] === true;
    const purchaseDetails = payloadForLabelPurchase(first, firstCombine);
    if (!purchaseDetails) {
      setElementsError("Selected order(s) have no checkout shipping address for Shippo.");
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
          const urlsFromTx = collectLabelUrlsFromTransactions(txs);
          if (urlsFromTx.length > 0) {
            const nextUrls = uniqueHttpUrls([...purchasedLabelUrlsRef.current, ...urlsFromTx]);
            purchasedLabelUrlsRef.current = nextUrls;
            setPurchasedLabelUrls(nextUrls);
          }
          const firstTx = txs[0] as ElementsTransactionPayload;
          const parcel = currentParcelRef.current;
          const payload = transactionToLabelFromElementsPayload(firstTx, {
            weightOz: parcel?.weightOz ?? DEFAULT_WEIGHT_OZ,
            lengthIn: parcel?.lengthIn ?? DEFAULT_LENGTH_IN,
            widthIn: parcel?.widthIn ?? DEFAULT_WIDTH_IN,
            heightIn: parcel?.heightIn ?? DEFAULT_HEIGHT_IN,
          });
          const shippoOrderId =
            firstTx.order_id?.trim() || shippoOrderIdsRef.current[0]?.trim() || null;
          const snap = currentShipToSnapshotRef.current;
          try {
            const res = await fetch("/api/shipping/label-from-elements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderIds: labeledOrderIds,
                ...payload,
                ...(shippoOrderId ? { shippoOrderId } : {}),
                ...(snap
                  ? {
                      shipToSnapshot: {
                        street: snap.street,
                        city: snap.city,
                        state: snap.state,
                        zip: snap.zip,
                        ...(snap.aptOrSuite?.trim() ? { aptOrSuite: snap.aptOrSuite.trim() } : {}),
                      },
                    }
                  : {}),
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
              const savedUrl =
                typeof (data as { shipment?: { labelUrl?: string | null } }).shipment?.labelUrl === "string"
                  ? (data as { shipment: { labelUrl: string } }).shipment.labelUrl
                  : null;
              if (savedUrl) {
                const nextUrls = uniqueHttpUrls([...purchasedLabelUrlsRef.current, savedUrl]);
                if (nextUrls.length !== purchasedLabelUrlsRef.current.length) {
                  purchasedLabelUrlsRef.current = nextUrls;
                  setPurchasedLabelUrls(nextUrls);
                }
              }
              let shippoNow =
                typeof window !== "undefined" ? (window as { shippo?: ShippoElementsAPI }).shippo : null;
              shippoNow = shippoNow && isShippoReady(shippoNow) ? shippoNow : null;
              if (!shippoNow) {
                shippoNow = await waitForShippo();
              }
              if (shippoNow && isShippoReady(shippoNow)) {
                await advanceOrFinishRef.current(shippoNow, labeledOrderIds);
              } else {
                sessionCompleteRef.current = true;
                setProgressSubtitle(
                  purchasedLabelUrlsRef.current.length > 0
                    ? "Label purchased — print it now, then close."
                    : "Label saved. Refresh this page if the next step did not open."
                );
                onSessionCompleteRef.current?.({
                  orderIds: [...sessionLabeledOrderIdsRef.current, ...labeledOrderIds],
                  labelUrls: purchasedLabelUrlsRef.current,
                });
                bulkFlowActiveRef.current = false;
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
        shippo.on("CLOSE_BUTTON_CLICKED", () => {
          closeShippoSurfaceRef.current();
        });
      }

      setProgressSubtitle(
        firstCombine
          ? `One shipment ${purchaseDetails.order_number ?? ""} for ${first.length} orders`
          : groups.length > 1
            ? `Buyer 1 of ${groups.length}`
            : null
      );
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
      currentShipToSnapshotRef.current = resolvePostalShipToAddress(first[0]);
      currentParcelRef.current = combinedParcelForOrders(first);
      shippo.labelPurchase(`#${containerIdRef.current}`, purchaseDetails);
    } catch {
      setElementsError("Connection failed.");
    } finally {
      setElementsLoading(false);
    }
  }, [orders]);

  const closeShippoSurface = useCallback(() => {
    if (sessionCompleteRef.current && sessionLabeledOrderIdsRef.current.length > 0) {
      notifyNwAppShippoLabelSuccess({ orderIds: sessionLabeledOrderIdsRef.current });
    }
    bulkFlowActiveRef.current = false;
    labelSuccessHandlingRef.current = false;
    sessionCompleteRef.current = false;
    clearShippoElementsMount(containerIdRef.current);
    setShippoSurfaceOpen(false);
    setProgressSubtitle(null);
    buyerGroupsRef.current = [];
    combineFlagsRef.current = [];
    groupIndexRef.current = 0;
    sessionLabeledOrderIdsRef.current = [];
    onDismissRef.current?.();
  }, []);
  closeShippoSurfaceRef.current = closeShippoSurface;

  const printPurchasedLabels = useCallback(() => {
    openLabelPdfUrls(purchasedLabelUrlsRef.current);
  }, []);

  return {
    elementsLoading,
    elementsError,
    setElementsError,
    shippoSurfaceOpen,
    closeShippoSurface,
    runBulkFlow,
    progressSubtitle,
    purchasedLabelUrls,
    printPurchasedLabels,
  };
}
