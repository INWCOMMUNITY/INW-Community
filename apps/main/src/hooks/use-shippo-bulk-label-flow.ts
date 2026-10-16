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

export type BulkShipGroup = { orderIds: string[]; combine: boolean };

/**
 * One label per explicit box, then one label per order that was left out.
 * An order is combined only when it sits in a box the seller created. Sharing a buyer is not enough.
 */
export function purchaseGroupsForSelection(selectedIds: string[], combinedGroups: string[][]): BulkShipGroup[] {
  const selected = new Set(selectedIds);
  const consumed = new Set<string>();
  const groups: BulkShipGroup[] = [];
  for (const group of combinedGroups) {
    const ids = [...new Set(group.filter((id) => selected.has(id)))];
    if (ids.length >= 2 && ids.length === group.length) {
      groups.push({ orderIds: ids, combine: true });
      ids.forEach((id) => consumed.add(id));
    }
  }
  for (const id of selectedIds) {
    if (!consumed.has(id)) groups.push({ orderIds: [id], combine: false });
  }
  return groups;
}

/** Same batches as labels: one packing slip for each combined box, and one for each order left out. */
export function packingSlipGroupsForSelection(selectedIds: string[], combinedGroups: string[][]): string[][] {
  return purchaseGroupsForSelection(selectedIds, combinedGroups).map((group) => group.orderIds);
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

export type LabelPurchasePayload = {
  address_to: unknown;
  line_items: Array<{
    title?: string;
    quantity?: number;
    currency?: string;
    unit_amount?: string;
    unit_weight?: string;
    weight_unit?: string;
    country_of_origin?: string;
  }>;
  order_number?: string;
};

function oneLineItemPayload(
  details: NonNullable<ReturnType<typeof buildOrderDetailsFromOrder>>,
  title: string
): LabelPurchasePayload {
  let amountCents = 0;
  let weightOz = 0;
  for (const item of details.line_items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    amountCents += Math.round(parseFloat(item.unit_amount || "0") * 100) * qty;
    weightOz += (parseFloat(item.unit_weight || "16") || 16) * qty;
  }
  if (weightOz <= 0) weightOz = 16;
  return {
    address_to: details.address_to,
    line_items: [
      {
        title,
        quantity: 1,
        currency: "USD",
        unit_amount: (amountCents / 100).toFixed(2),
        unit_weight: String(Math.round(weightOz)),
        weight_unit: "oz",
        country_of_origin: "US",
      },
    ],
    ...(details.order_number ? { order_number: details.order_number } : {}),
  };
}

/**
 * Payload for one label.
 * A combined box is one new order with one line item and no previously saved Shippo id.
 * When several labels are purchased together, a leftover order is also one line item under a
 * new order number so Shippo cannot resume an older order or split that order into extra packages.
 */
function payloadForLabelPurchase(
  orders: StoreOrderForBulkLabel[],
  combine: boolean,
  collapseSingle: boolean
): LabelPurchasePayload | null {
  if (!combine && collapseSingle && orders.length === 1) {
    const details = buildOrderDetailsFromOrder(orders[0], undefined, { freshShippoOrder: true });
    if (!details || Array.isArray(details) || details.line_items.length === 0) return null;
    const title = details.line_items.length === 1 ? details.line_items[0]?.title ?? "Shipment" : "Shipment";
    return oneLineItemPayload(details, title);
  }
  const details = singleShippoOrder(buildBulkOrderDetails(orders, combine));
  if (!details || details.line_items.length === 0) return null;
  if (combine && (orders.length < 2 || details.line_items.length !== 1)) return null;
  return {
    address_to: details.address_to,
    line_items: details.line_items.slice(0, combine ? 1 : details.line_items.length),
    ...(details.order_number ? { order_number: details.order_number } : {}),
  };
}

/**
 * One Shippo order per selected box. Passing this array to labelPurchase is bulk mode:
 * one label card per box, not one shipment that contains every selected order.
 */
export function labelPayloadsForBatches(
  batches: { orders: StoreOrderForBulkLabel[]; combine: boolean }[]
): LabelPurchasePayload[] | null {
  if (batches.length === 0) return null;
  const collapseSingles = batches.length > 1;
  const payloads: LabelPurchasePayload[] = [];
  for (const batch of batches) {
    const payload = payloadForLabelPurchase(batch.orders, batch.combine, collapseSingles);
    if (!payload) return null;
    if (batches.length > 1 && payload.line_items.length !== 1) return null;
    payloads.push(payload);
  }
  const numbers = payloads.map((payload) => payload.order_number).filter(Boolean);
  if (new Set(numbers).size !== numbers.length) return null;
  return payloads;
}

type MatchableLabelTransaction = { order_id?: string; order_number?: string; object_id?: string };

/**
 * Match each purchased Shippo transaction to one box. Never assigns one transaction to every box.
 */
export function assignTransactionsToBatches<T extends MatchableLabelTransaction>(
  transactions: T[],
  args: {
    batchCount: number;
    batchOrderNumbers: string[];
    createdOrderIds: string[];
    savedIndexes: number[];
  }
): { assignments: { batchIndex: number; transaction: T }[]; createdOrderIds: string[] } {
  const saved = new Set(args.savedIndexes);
  const used = new Set<number>();
  const created = [...args.createdOrderIds];
  const assignments: { batchIndex: number; transaction: T }[] = [];

  const unsaved = () => {
    const left: number[] = [];
    for (let i = 0; i < args.batchCount; i++) {
      if (!saved.has(i) && !used.has(i)) left.push(i);
    }
    return left;
  };

  const claim = (index: number, transaction: T) => {
    if (index < 0 || index >= args.batchCount || saved.has(index) || used.has(index)) return false;
    used.add(index);
    assignments.push({ batchIndex: index, transaction });
    const orderId = transaction.order_id?.trim();
    if (orderId && !created.includes(orderId)) created[index] = orderId;
    return true;
  };

  const unmatched: T[] = [];
  for (const transaction of transactions) {
    const orderNumber = transaction.order_number?.trim();
    if (orderNumber) {
      const found = args.batchOrderNumbers.findIndex((number) => number === orderNumber);
      if (claim(found, transaction)) continue;
    }
    const orderId = transaction.order_id?.trim();
    if (orderId) {
      const known = created.indexOf(orderId);
      if (known >= 0 && claim(known, transaction)) continue;
      const next = created.findIndex((id) => !id);
      const slot = next >= 0 ? next : created.length;
      if (slot < args.batchCount && claim(slot, transaction)) continue;
    }
    unmatched.push(transaction);
  }

  const left = unsaved();
  if (assignments.length === 0 && unmatched.length > 0 && unmatched.length === left.length) {
    unmatched.forEach((transaction, index) => {
      claim(left[index] ?? -1, transaction);
    });
  } else if (assignments.length === 0 && unmatched.length === 1 && left.length === 1) {
    claim(left[0] ?? -1, unmatched[0]);
  }

  return { assignments, createdOrderIds: created };
}

export type ShippoLabelSessionResult = {
  orderIds: string[];
  labelUrls: string[];
};

async function saveLabelToOrders(
  tx: ElementsTransactionPayload,
  orders: StoreOrderForBulkLabel[],
  shippoOrderId: string | null
): Promise<{ ok: boolean; error?: string; labelUrl?: string | null }> {
  const parcel = combinedParcelForOrders(orders);
  const payload = transactionToLabelFromElementsPayload(tx, {
    weightOz: parcel?.weightOz ?? DEFAULT_WEIGHT_OZ,
    lengthIn: parcel?.lengthIn ?? DEFAULT_LENGTH_IN,
    widthIn: parcel?.widthIn ?? DEFAULT_WIDTH_IN,
    heightIn: parcel?.heightIn ?? DEFAULT_HEIGHT_IN,
  });
  const snap = orders[0] ? resolvePostalShipToAddress(orders[0]) : null;
  const res = await fetch("/api/shipping/label-from-elements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderIds: orders.map((order) => order.id),
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
  if (!res.ok) {
    return {
      ok: false,
      error:
        typeof (data as { error?: string }).error === "string"
          ? (data as { error: string }).error
          : "Could not save label to your order. If you were charged, contact support with your order number.",
    };
  }
  const labelUrl =
    typeof (data as { shipment?: { labelUrl?: string | null } }).shipment?.labelUrl === "string"
      ? (data as { shipment: { labelUrl: string } }).shipment.labelUrl
      : null;
  return { ok: true, labelUrl };
}

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
  const shippoOrderIdsRef = useRef<string[]>([]);
  const buyerGroupsRef = useRef<StoreOrderForBulkLabel[][]>([]);
  const combineFlagsRef = useRef<boolean[]>([]);
  const groupIndexRef = useRef(0);
  const labelBatchesRef = useRef<
    { orderIds: string[]; orderNumber: string; orders: StoreOrderForBulkLabel[] }[]
  >([]);
  const savedBatchIndexesRef = useRef<Set<number>>(new Set());
  const savedTransactionIdsRef = useRef<Set<string>>(new Set());
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

  const finishLabelSession = useCallback(() => {
    sessionCompleteRef.current = true;
    bulkFlowActiveRef.current = false;
    setProgressSubtitle(
      purchasedLabelUrlsRef.current.length > 0
        ? "Labels purchased — print them now, then close."
        : "Labels purchased. Close when you are done."
    );
    onSessionCompleteRef.current?.({
      orderIds: sessionLabeledOrderIdsRef.current,
      labelUrls: purchasedLabelUrlsRef.current,
    });
  }, []);

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

    const explicitGroups =
      options?.groups && options.groups.length > 0
        ? options.groups
        : options?.combine === true
          ? [{ orderIds: selected.map((order) => order.id), combine: true }]
          : selected.map((order) => ({ orderIds: [order.id], combine: false }));
    const resolved: { orders: StoreOrderForBulkLabel[]; combine: boolean }[] = [];
    const byId = new Map(selected.map((order) => [order.id, order]));
    const used = new Set<string>();
    for (const group of explicitGroups) {
      const members: StoreOrderForBulkLabel[] = [];
      for (const id of group.orderIds) {
        if (used.has(id)) continue;
        const order = byId.get(id);
        if (!order) continue;
        members.push(order);
        used.add(id);
      }
      if (members.length === 0) continue;
      if (group.combine && members.length > 1) {
        if (!ordersCanCombineShipping(members)) {
          setElementsError("Combined orders must be from the same person and the same address.");
          return;
        }
        resolved.push({ orders: members, combine: true });
      } else {
        for (const order of members) resolved.push({ orders: [order], combine: false });
      }
    }
    for (const order of selected) {
      if (!used.has(order.id)) resolved.push({ orders: [order], combine: false });
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

    const payloads = labelPayloadsForBatches(opened);
    if (!payloads) {
      setElementsError("Selected order(s) have no checkout shipping address for Shippo.");
      return;
    }
    labelBatchesRef.current = opened.map((group, index) => ({
      orderIds: group.orders.map((order) => order.id),
      orderNumber: payloads[index]?.order_number ?? "",
      orders: group.orders,
    }));
    savedBatchIndexesRef.current = new Set();
    savedTransactionIdsRef.current = new Set();

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
          const txs = Array.isArray(transactions)
            ? (transactions as Array<ElementsTransactionPayload & { order_number?: string }>)
            : [];
          const batches = labelBatchesRef.current;
          if (batches.length === 0 || txs.length === 0) return;
          const fresh = txs.filter((tx) => {
            const id = tx.object_id?.trim();
            return !id || !savedTransactionIdsRef.current.has(id);
          });
          if (fresh.length === 0) return;
          const matched = assignTransactionsToBatches(fresh, {
            batchCount: batches.length,
            batchOrderNumbers: batches.map((batch) => batch.orderNumber),
            createdOrderIds: shippoOrderIdsRef.current,
            savedIndexes: [...savedBatchIndexesRef.current],
          });
          shippoOrderIdsRef.current = matched.createdOrderIds;
          if (matched.assignments.length === 0) {
            setElementsError(
              "A label was purchased, but it could not be matched to one box. If you were charged, contact support before buying another."
            );
            return;
          }
          labelSuccessHandlingRef.current = true;
          const urlsFromTx = collectLabelUrlsFromTransactions(
            matched.assignments.map((row) => row.transaction)
          );
          if (urlsFromTx.length > 0) {
            const nextUrls = uniqueHttpUrls([...purchasedLabelUrlsRef.current, ...urlsFromTx]);
            purchasedLabelUrlsRef.current = nextUrls;
            setPurchasedLabelUrls(nextUrls);
          }
          try {
            for (const { batchIndex, transaction } of matched.assignments) {
              const batch = batches[batchIndex];
              if (!batch) continue;
              const shippoOrderId =
                transaction.order_id?.trim() ||
                (batches.length === 1 ? shippoOrderIdsRef.current[batchIndex]?.trim() : null) ||
                null;
              const saved = await saveLabelToOrders(transaction, batch.orders, shippoOrderId);
              if (!saved.ok) {
                setElementsError(saved.error ?? "Could not save label to your order.");
                return;
              }
              savedBatchIndexesRef.current.add(batchIndex);
              const txId = transaction.object_id?.trim();
              if (txId) savedTransactionIdsRef.current.add(txId);
              sessionLabeledOrderIdsRef.current = [
                ...sessionLabeledOrderIdsRef.current,
                ...batch.orderIds,
              ];
              if (saved.labelUrl) {
                const nextUrls = uniqueHttpUrls([...purchasedLabelUrlsRef.current, saved.labelUrl]);
                if (nextUrls.length !== purchasedLabelUrlsRef.current.length) {
                  purchasedLabelUrlsRef.current = nextUrls;
                  setPurchasedLabelUrls(nextUrls);
                }
              }
            }
            onAfterSaveRef.current();
            if (savedBatchIndexesRef.current.size >= batches.length) {
              finishLabelSession();
            } else {
              setProgressSubtitle(
                `${savedBatchIndexesRef.current.size} of ${batches.length} labels saved. Each remaining box is its own label in this window.`
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
        payloads.length > 1
          ? `${payloads.length} separate labels — one for each box you selected`
          : opened[0]?.combine
            ? `One shipment ${payloads[0]?.order_number ?? ""} for ${opened[0]?.orders.length ?? 0} orders`
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
      shippo.labelPurchase(
        `#${containerIdRef.current}`,
        payloads.length === 1 ? payloads[0] : payloads
      );
    } catch {
      setElementsError("Connection failed.");
    } finally {
      setElementsLoading(false);
    }
  }, [finishLabelSession, orders]);

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
    labelBatchesRef.current = [];
    savedBatchIndexesRef.current = new Set();
    savedTransactionIdsRef.current = new Set();
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
