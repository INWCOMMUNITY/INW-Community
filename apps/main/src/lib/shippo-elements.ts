/**
 * Helpers for Shippo Shipping Elements: build OrderDetails from store orders
 * and normalize LABEL_PURCHASED_SUCCESS transaction for our API.
 */

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

export interface ShippoElementsOrderDetails {
  address_to: ShippoElementsAddress;
  line_items: ShippoElementsLineItem[];
  order_number?: string;
  object_id?: string;
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
  buyer: { firstName: string; lastName: string; email?: string };
  items: Array<{
    storeItem: { title: string };
    quantity: number;
    priceCentsAtPurchase: number;
  }>;
}

export type BuildOrderDetailsOptions = {
  /**
   * When true, append a unique suffix to `order_number` so Shippo opens a **new** order.
   * Use for “purchase another label” on orders that already have a shipment; otherwise Shippo
   * may resume the prior order because `order_number` matches.
   */
  freshShippoOrder?: boolean;
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
  const addr = order.shippingAddress as { street?: string; aptOrSuite?: string; city?: string; state?: string; zip?: string } | null;
  if (!addr?.street?.trim() || !addr?.city?.trim() || !addr?.state?.trim() || !addr?.zip?.trim()) {
    return null;
  }
  const { street1, street2 } = splitStreet1Street2(addr.street.trim(), addr.aptOrSuite?.trim() ?? "");
  const name = `${order.buyer.firstName} ${order.buyer.lastName}`.trim() || "Recipient";
  let line_items: ShippoElementsLineItem[] = order.items.map((item) => ({
    title: item.storeItem?.title ?? "Item",
    quantity: item.quantity,
    currency: "USD",
    unit_amount: (item.priceCentsAtPurchase / 100).toFixed(2),
    unit_weight: "1",
    weight_unit: "lb",
    country_of_origin: "US",
  }));
  if (line_items.length === 0) {
    line_items = [
      {
        title: "Order",
        quantity: 1,
        currency: "USD",
        unit_amount: "0.00",
        unit_weight: "1",
        weight_unit: "lb",
        country_of_origin: "US",
      },
    ];
  }

  const baseOrderNumber = String(order.orderNumber ?? order.id);
  let order_number: string;
  if (objectId?.trim()) {
    order_number = baseOrderNumber;
  } else if (options?.freshShippoOrder) {
    const safeBase = baseOrderNumber.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28);
    order_number = `${safeBase}-L${Date.now()}`.slice(0, 64);
  } else {
    order_number = baseOrderNumber;
  }

  return {
    address_to: {
      name,
      street1: street1.slice(0, 35),
      ...(street2 ? { street2: street2.slice(0, 35) } : {}),
      city: addr.city.trim(),
      state: addr.state.trim(),
      zip: addr.zip.trim().replace(/\D/g, "").slice(0, 10),
      country: "US",
      ...(order.buyer.email?.trim() ? { email: order.buyer.email.trim().slice(0, 128) } : {}),
    },
    line_items,
    order_number,
    ...(objectId?.trim() ? { object_id: objectId.trim() } : {}),
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
  label_url?: string;
  tracking_number?: string;
  tracking_url_provider?: string;
  rate?: {
    provider?: string;
    servicelevel?: { name?: string };
    amount?: string;
  };
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
  const rate = tx.rate as { amount?: string; provider?: string; carrier?: string; servicelevel?: { name?: string } } | undefined;
  const amountStr = rate?.amount ?? "0";
  const rateCents = Math.round(parseFloat(amountStr) * 100);
  const carrier = rate?.provider ?? rate?.carrier ?? "Carrier";
  const service = rate?.servicelevel?.name ?? "Standard";
  const trackingNumber = tx.tracking_number?.trim() ?? null;
  return {
    carrier,
    service,
    rateCents,
    labelUrl: tx.label_url?.trim() ?? null,
    trackingNumber,
    shippoTransactionId: tx.object_id?.trim() ?? null,
    weightOz: options.weightOz ?? 16,
    lengthIn: options.lengthIn ?? 12,
    widthIn: options.widthIn ?? 12,
    heightIn: options.heightIn ?? 12,
  };
}
