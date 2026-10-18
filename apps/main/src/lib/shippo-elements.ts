/**
 * Helpers for Shippo Shipping Elements: build OrderDetails from store orders
 * and normalize LABEL_PURCHASED_SUCCESS transaction for our API.
 */

import {
  combinePackages,
  isPackageComplete,
  type PackageMeasurements,
} from "@/lib/package-weight";

export interface ShippoElementsAddress {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface ShippoElementsLineItem {
  title: string;
  sku?: string;
  quantity: number;
  currency: string;
  unit_amount: string;
  unit_weight: string;
  weight_unit: string;
  country_of_origin?: string;
}

/** Parcel shape accepted by Shippo Elements / Label Purchase (inches + ounces). */
export interface ShippoElementsParcel {
  length: string;
  width: string;
  height: string;
  distance_unit: "in";
  weight: string;
  mass_unit: "oz";
}

export interface ShippoElementsOrderDetails {
  address_from?: ShippoElementsAddress;
  address_to: ShippoElementsAddress;
  line_items: ShippoElementsLineItem[];
  /** Pre-fill package size/weight from listing shipping options so sellers skip re-entry. */
  parcels?: ShippoElementsParcel[];
  order_number?: string;
  object_id?: string;
  extra?: { is_return?: boolean };
}

export function packageMeasurementsToShippoParcel(
  pkg: PackageMeasurements
): ShippoElementsParcel {
  return {
    length: String(pkg.lengthIn),
    width: String(pkg.widthIn),
    height: String(pkg.heightIn),
    distance_unit: "in",
    weight: String(pkg.weightOz),
    mass_unit: "oz",
  };
}

function splitStreet1Street2(street: string, aptOrSuite: string): { street1: string; street2: string } {
  const streetTrim = street.trim();
  const apt = aptOrSuite?.trim() ?? "";
  if (apt || streetTrim.length <= 35) return { street1: streetTrim || "", street2: apt };
  const unitMatch = streetTrim.match(
    /\s+(Apt\.?|Suite|Ste\.?|Unit|#|Floor|Fl\.?|Bldg\.?|Building)\s*\.?\s*[\dA-Za-z#-]+$/i
  );
  if (!unitMatch) return { street1: streetTrim, street2: apt };
  const idx = streetTrim.length - unitMatch[0].length;
  return {
    street1: streetTrim.slice(0, idx).trim(),
    street2: unitMatch[0].trim() || apt,
  };
}

export interface OrderForElements {
  id: string;
  orderNumber?: string;
  shippingAddress: unknown;
  /** Local delivery / pickup orders may only have ship-to here (shippingAddress null). */
  localDeliveryDetails?: unknown;
  buyer: { firstName: string; lastName: string; email?: string };
  items: Array<{
    storeItem: {
      title: string;
      shippingOption?: {
        weightOz: number | null;
        lengthIn: number | null;
        widthIn: number | null;
        heightIn: number | null;
      } | null;
    };
    quantity: number;
    priceCentsAtPurchase: number;
    fulfillmentType?: string | null;
  }>;
}

export function parcelFromOrderItems(order: OrderForElements): PackageMeasurements | null {
  const packages = order.items
    .map((item) => {
      const pkg = item.storeItem?.shippingOption;
      if (!pkg || !isPackageComplete(pkg)) return null;
      return { ...pkg, quantity: item.quantity };
    })
    .filter((p): p is PackageMeasurements & { quantity: number } => p != null);
  return combinePackages(packages);
}

/** Normalized ship-to line used for Shippo Elements (US). */
export type ResolvedShipToLine = {
  street: string;
  aptOrSuite: string;
  city: string;
  state: string;
  zip: string;
};

function pickFirstNonEmptyString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Normalize historical / third-party JSON shapes (Stripe, Places, local delivery) into one ship-to line.
 */
export function normalizeLooseAddressSnapshot(raw: unknown): ResolvedShipToLine | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const street = pickFirstNonEmptyString(o, [
    "street",
    "address",
    "line1",
    "line_1",
    "address_line1",
    "addressLine1",
    "street1",
  ]);
  const city = pickFirstNonEmptyString(o, ["city", "town", "locality"]);
  const state = pickFirstNonEmptyString(o, ["state", "state_code", "province", "region", "administrative_area_level_1"]);
  const zipRaw = pickFirstNonEmptyString(o, ["zip", "postal_code", "postalCode", "postal", "zipCode"]);
  const aptOrSuite =
    pickFirstNonEmptyString(o, [
      "aptOrSuite",
      "street2",
      "address2",
      "line2",
      "line_2",
      "address_line2",
      "addressLine2",
      "unit",
      "subpremise",
    ]) ?? "";
  if (!street || !city || !state || !zipRaw) return null;
  const zipDigits = zipRaw.replace(/\D/g, "").slice(0, 10);
  if (zipDigits.length < 5) return null;
  return { street, aptOrSuite, city, state, zip: zipDigits };
}

/**
 * Resolve ship-to for **postal / Shippo labels** only: `StoreOrder.shipping_address`
 * (the checkout shipping slot — app form, Stripe Checkout `shipping_details`, or webhook backfill).
 * Does not use `localDeliveryDetails.deliveryAddress`, which is for seller local delivery and may differ.
 */
export function resolvePostalShipToAddress(order: { shippingAddress?: unknown }): ResolvedShipToLine | null {
  return normalizeLooseAddressSnapshot(order.shippingAddress);
}

/**
 * Resolve ship-to for display, packing slips, or merging combined orders: prefer checkout shipping,
 * then local delivery drop-off address if present.
 */
export function resolveOrderShipToAddress(order: {
  shippingAddress?: unknown;
  localDeliveryDetails?: unknown;
}): ResolvedShipToLine | null {
  const fromShipping = normalizeLooseAddressSnapshot(order.shippingAddress);
  if (fromShipping) return fromShipping;
  const ld = order.localDeliveryDetails;
  if (ld && typeof ld === "object") {
    const d = ld as Record<string, unknown>;
    const delivery = d.deliveryAddress ?? d.delivery_address;
    const fromDelivery = normalizeLooseAddressSnapshot(delivery);
    if (fromDelivery) return fromDelivery;
  }
  return null;
}

/** Shape stored on `StoreOrder.shipping_address` so order details and future labels can resolve ship-to. */
export function resolvedShipToToOrderShippingJson(addr: ResolvedShipToLine): {
  street: string;
  city: string;
  state: string;
  zip: string;
  aptOrSuite?: string;
} {
  const out: {
    street: string;
    city: string;
    state: string;
    zip: string;
    aptOrSuite?: string;
  } = {
    street: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  };
  if (addr.aptOrSuite?.trim()) out.aptOrSuite = addr.aptOrSuite.trim();
  return out;
}

export type BuildOrderDetailsOptions = {
  /**
   * When true, append a unique suffix to `order_number` so Shippo opens a **new** order.
   * Use for “purchase another label” on orders that already have a shipment; otherwise Shippo
   * may resume the prior order because `order_number` matches.
   */
  freshShippoOrder?: boolean;
  /** Buyer → seller return label (swaps addresses). */
  isReturn?: boolean;
  sellerFromAddress?: ShippoElementsAddress | null;
};

/**
 * Build Shippo Elements OrderDetails from a single store order.
 * Pass objectId to re-open an existing Shippo order (e.g. for re-print).
 */
export function buildOrderDetailsFromOrder(
  order: OrderForElements,
  objectId?: string | null,
  options?: BuildOrderDetailsOptions
): ShippoElementsOrderDetails | null {
  const addr = options?.isReturn
    ? resolvePostalShipToAddress(order) ?? resolveOrderShipToAddress(order)
    : resolvePostalShipToAddress(order);
  if (!addr) return null;
  const { street1, street2 } = splitStreet1Street2(addr.street, addr.aptOrSuite);
  const name = `${order.buyer.firstName} ${order.buyer.lastName}`.trim() || "Recipient";
  let line_items: ShippoElementsLineItem[] = order.items.map((item) => {
    const pkg = item.storeItem?.shippingOption;
    const unitOz =
      pkg && isPackageComplete(pkg) ? String(pkg.weightOz) : "16";
    return {
      title: item.storeItem?.title ?? "Item",
      quantity: item.quantity,
      currency: "USD",
      unit_amount: (item.priceCentsAtPurchase / 100).toFixed(2),
      unit_weight: unitOz,
      weight_unit: "oz",
      country_of_origin: "US",
    };
  });
  if (line_items.length === 0) {
    line_items = [
      {
        title: "Order",
        quantity: 1,
        currency: "USD",
        unit_amount: "0.00",
        unit_weight: "16",
        weight_unit: "oz",
        country_of_origin: "US",
      },
    ];
  }

  const baseOrderNumber = String(order.orderNumber ?? order.id);
  let order_number: string;
  if (objectId?.trim()) {
    order_number = baseOrderNumber;
  } else if (options?.isReturn) {
    const safeBase = baseOrderNumber.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 26);
    order_number = `${safeBase}-R${Date.now()}`.slice(0, 64);
  } else if (options?.freshShippoOrder) {
    const safeBase = baseOrderNumber.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28);
    order_number = `${safeBase}-L${Date.now()}`.slice(0, 64);
  } else {
    order_number = baseOrderNumber;
  }

  const buyerAddress: ShippoElementsAddress = {
    name,
    street1: street1.slice(0, 35),
    ...(street2 ? { street2: street2.slice(0, 35) } : {}),
    city: addr.city.slice(0, 64),
    state: addr.state.slice(0, 32),
    zip: addr.zip,
    country: "US",
    ...(order.buyer.email?.trim() ? { email: order.buyer.email.trim().slice(0, 128) } : {}),
  };

  const combinedParcel = parcelFromOrderItems(order);
  const parcels = combinedParcel
    ? [packageMeasurementsToShippoParcel(combinedParcel)]
    : undefined;

  if (options?.isReturn) {
    const sellerAddr = options.sellerFromAddress;
    if (!sellerAddr?.street1?.trim() || !sellerAddr.city?.trim() || !sellerAddr.state?.trim() || !sellerAddr.zip?.trim()) {
      return null;
    }
    const sellerPhone = sellerAddr.phone?.trim().slice(0, 32);
    return {
      address_from: {
        ...buyerAddress,
        ...(sellerPhone ? { phone: sellerPhone } : {}),
      },
      address_to: {
        ...sellerAddr,
        street1: sellerAddr.street1.slice(0, 35),
        ...(sellerAddr.street2 ? { street2: sellerAddr.street2.slice(0, 35) } : {}),
        city: sellerAddr.city.slice(0, 64),
        state: sellerAddr.state.slice(0, 32),
        zip: sellerAddr.zip,
        country: sellerAddr.country || "US",
      },
      line_items,
      ...(parcels ? { parcels } : {}),
      order_number,
      extra: { is_return: true },
    };
  }

  return {
    address_to: buyerAddress,
    line_items,
    ...(parcels ? { parcels } : {}),
    order_number,
    ...(objectId?.trim() ? { object_id: objectId.trim() } : {}),
  };
}

function postalAddressKey(raw: unknown): string | null {
  const addr = normalizeLooseAddressSnapshot(raw);
  if (!addr) return null;
  const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return [addr.street, addr.aptOrSuite, addr.city, addr.state, addr.zip].map(norm).join("|");
}

/** Two or more paid ship orders for one buyer, going to the same checkout address. */
export function ordersCanCombineShipping(
  orders: Array<{ buyer?: { email?: string | null }; shippingAddress?: unknown }>
): boolean {
  if (orders.length < 2) return false;
  const emails = orders.map((order) => order.buyer?.email?.trim().toLowerCase() ?? "");
  if (emails.some((email) => !email) || new Set(emails).size !== 1) return false;
  const keys = orders.map((order) => postalAddressKey(order.shippingAddress));
  if (keys.some((key) => !key) || new Set(keys).size !== 1) return false;
  return true;
}

function postalLineItems(order: OrderForElements): OrderForElements["items"] {
  const shipped = order.items.filter((item) => (item.fulfillmentType ?? "ship") === "ship");
  return shipped.length > 0 ? shipped : order.items;
}

/** Groups of two or more orders that share a buyer email and checkout address. */
export function clusterOrdersForCombinedShipping<
  T extends { id: string; buyer?: { email?: string | null }; shippingAddress?: unknown },
>(orders: T[]): T[][] {
  const buckets = new Map<string, T[]>();
  for (const order of orders) {
    const email = order.buyer?.email?.trim().toLowerCase() ?? "";
    const address = postalAddressKey(order.shippingAddress);
    if (!email || !address) continue;
    const key = `${email}|${address}`;
    const list = buckets.get(key);
    if (list) list.push(order);
    else buckets.set(key, [order]);
  }
  return [...buckets.values()].filter((group) => group.length >= 2);
}

/**
 * Shippo matches and can split on `order_number`. A combined box gets a new number that
 * does not contain any INW order number. Those numbers stay on the INW orders.
 */
export function combinedShippoOrderNumber(): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `CMB${rand}`.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 32);
}

/**
 * One Shippo order and one package, assembled before label purchase.
 * Shipping Elements builds a package per line item and resumes orders whose
 * `order_number` it already knows, so this is a single line item under a new number.
 */
export function buildCombinedOrderDetails(
  orders: OrderForElements[]
): ShippoElementsOrderDetails | null {
  if (!ordersCanCombineShipping(orders)) return null;
  const items = orders.flatMap((order) => postalLineItems(order));
  const shell = buildOrderDetailsFromOrder({
    ...orders[0],
    orderNumber: undefined,
    items: items.length > 0 ? items : orders[0].items,
  });
  if (!shell) return null;
  const packedItems = items.length > 0 ? items : orders[0].items;
  const parcel = parcelFromOrderItems({ ...orders[0], items: packedItems });
  const weightOz =
    parcel?.weightOz ??
    packedItems.reduce((sum, item) => sum + 16 * Math.max(1, item.quantity), 0);
  const amountCents = packedItems.reduce(
    (sum, item) => sum + item.priceCentsAtPurchase * Math.max(1, item.quantity),
    0
  );
  const orderNumber = combinedShippoOrderNumber();
  return {
    address_to: shell.address_to,
    line_items: [
      {
        title: "Combined shipment",
        quantity: 1,
        currency: "USD",
        unit_amount: (amountCents / 100).toFixed(2),
        unit_weight: String(weightOz),
        weight_unit: "oz",
        country_of_origin: "US",
      },
    ],
    order_number: orderNumber,
  };
}

/**
 * Build OrderDetails array for multiple orders (same buyer); returns null if any order has invalid address.
 */
export function buildOrderDetailsFromOrders(orders: OrderForElements[]): ShippoElementsOrderDetails[] | null {
  const result: ShippoElementsOrderDetails[] = [];
  for (const order of orders) {
    const one = buildOrderDetailsFromOrder(order);
    if (!one) return null;
    result.push(one);
  }
  return result;
}

/**
 * Transaction payload from LABEL_PURCHASED_SUCCESS event (one element of the array).
 */
export interface ElementsTransactionPayload {
  /** Shippo Order object_id for this label purchase (use for our DB; preferred over ORDER_CREATED timing). */
  order_id?: string;
  object_id?: string;
  objectId?: string;
  transaction_id?: string;
  label_url?: string;
  labelUrl?: string;
  tracking_number?: string;
  trackingNumber?: string;
  tracking_url_provider?: string;
  rate?:
    | string
    | {
        provider?: string;
        carrier?: string;
        servicelevel_name?: string;
        servicelevel?: { name?: string };
        amount?: string | number;
      };
}

/** Deduplicate http(s) URLs; drop blanks and non-http schemes. */
export function uniqueHttpUrls(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function payloadString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function looksLikeElementsTransaction(value: unknown): value is ElementsTransactionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    payloadString(record.object_id) ||
      payloadString(record.objectId) ||
      payloadString(record.transaction_id) ||
      payloadString(record.label_url) ||
      payloadString(record.labelUrl) ||
      payloadString(record.tracking_number) ||
      payloadString(record.trackingNumber)
  );
}

function transactionsFromUnknown(value: unknown, depth = 0): ElementsTransactionPayload[] {
  if (depth > 4 || value == null) return [];
  if (Array.isArray(value)) {
    const direct = value.filter(looksLikeElementsTransaction);
    if (direct.length > 0) return direct;
    return value.flatMap((item) => transactionsFromUnknown(item, depth + 1));
  }
  if (looksLikeElementsTransaction(value)) return [value];
  if (typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["transactions", "transaction", "data", "payload", "label", "result"]) {
    const found = transactionsFromUnknown(record[key], depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

/** Shippo sometimes sends one transaction object, or `{ transactions: [...] }`, instead of a bare array. */
export function elementsTransactionsFromEvent(transactions: unknown): ElementsTransactionPayload[] {
  return transactionsFromUnknown(transactions);
}

export function collectLabelUrlsFromTransactions(txs: ElementsTransactionPayload[]): string[] {
  return uniqueHttpUrls(txs.map((tx) => payloadString(tx.label_url) ?? payloadString(tx.labelUrl)));
}

/**
 * Open each label PDF in a new tab. Call from a click handler when possible;
 * iframe callbacks are often treated as non-gestures and may be popup-blocked.
 * Skip auto-open inside the Expo WebView so we do not navigate away from Shippo.
 */
export function openLabelPdfUrls(urls: string[]): { opened: string[]; blocked: string[] } {
  const unique = uniqueHttpUrls(urls);
  if (typeof window === "undefined") return { opened: [], blocked: unique };
  const w = window as Window & { ReactNativeWebView?: unknown };
  if (w.ReactNativeWebView) return { opened: [], blocked: unique };

  const opened: string[] = [];
  const blocked: string[] = [];
  for (const url of unique) {
    const popup = window.open(url, "_blank");
    if (popup) {
      popup.opener = null;
      opened.push(url);
    } else {
      blocked.push(url);
    }
  }
  return { opened, blocked };
}

/**
 * Normalize a transaction from LABEL_PURCHASED_SUCCESS to the shape expected by POST /api/shipping/label-from-elements.
 */
export function transactionToLabelFromElementsPayload(
  tx: ElementsTransactionPayload,
  options: { weightOz?: number; lengthIn?: number; widthIn?: number; heightIn?: number } = {}
): {
  carrier: string;
  service: string;
  rateCents: number;
  labelUrl: string | null;
  trackingNumber: string | null;
  shippoTransactionId: string | null;
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
} {
  const rate = tx.rate && typeof tx.rate === "object" ? tx.rate : undefined;
  const amountRaw = rate?.amount ?? "0";
  const amount = typeof amountRaw === "number" ? amountRaw : Number.parseFloat(String(amountRaw));
  const rateCents = Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
  const carrier = rate?.provider ?? rate?.carrier ?? "Carrier";
  const service = rate?.servicelevel?.name ?? rate?.servicelevel_name ?? "Standard";
  const trackingNumber = payloadString(tx.tracking_number) ?? payloadString(tx.trackingNumber);
  return {
    carrier,
    service,
    rateCents,
    labelUrl: payloadString(tx.label_url) ?? payloadString(tx.labelUrl),
    trackingNumber,
    shippoTransactionId:
      payloadString(tx.object_id) ?? payloadString(tx.objectId) ?? payloadString(tx.transaction_id),
    weightOz: options.weightOz ?? 16,
    lengthIn: options.lengthIn ?? 12,
    widthIn: options.widthIn ?? 12,
    heightIn: options.heightIn ?? 12,
  };
}
