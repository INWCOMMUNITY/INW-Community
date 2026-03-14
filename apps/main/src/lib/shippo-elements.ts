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

/**
 * Build Shippo Elements OrderDetails from a single store order.
 */
export function buildOrderDetailsFromOrder(order: OrderForElements): ShippoElementsOrderDetails | null {
  const addr = order.shippingAddress as { street?: string; aptOrSuite?: string; city?: string; state?: string; zip?: string } | null;
  if (!addr?.street?.trim() || !addr?.city?.trim() || !addr?.state?.trim() || !addr?.zip?.trim()) {
    return null;
  }
  const { street1, street2 } = splitStreet1Street2(addr.street.trim(), addr.aptOrSuite?.trim() ?? "");
  const name = `${order.buyer.firstName} ${order.buyer.lastName}`.trim() || "Recipient";
  const line_items: ShippoElementsLineItem[] = order.items.map((item) => ({
    title: item.storeItem?.title ?? "Item",
    quantity: item.quantity,
    currency: "USD",
    unit_amount: (item.priceCentsAtPurchase / 100).toFixed(2),
    unit_weight: "1",
    weight_unit: "lb",
    country_of_origin: "US",
  }));
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
    order_number: order.orderNumber ?? order.id,
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
