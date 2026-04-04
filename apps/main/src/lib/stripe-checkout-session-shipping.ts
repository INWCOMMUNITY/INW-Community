import type Stripe from "stripe";

/** Map Stripe Checkout `shipping_details` into our StoreOrder.shipping_address JSON shape. */
export function shippingAddressFromCheckoutSession(session: Stripe.Checkout.Session): Record<string, string> | null {
  const sd = session.shipping_details;
  if (!sd?.address) return null;
  const a = sd.address;
  const street = (a.line1 ?? "").trim();
  const city = (a.city ?? "").trim();
  const state = (a.state ?? "").trim();
  const zip = (a.postal_code ?? "").trim().replace(/\D/g, "").slice(0, 5);
  if (!street || !city || !state || !zip) return null;
  const out: Record<string, string> = { street, city, state, zip };
  const line2 = (a.line2 ?? "").trim();
  if (line2) out.aptOrSuite = line2;
  return out;
}

export function storeOrderNeedsShippingBackfill(order: {
  shippingAddress: unknown;
  items: { fulfillmentType?: string | null }[];
}): boolean {
  const hasShipped = order.items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  if (!hasShipped) return false;
  const sa = order.shippingAddress;
  if (sa == null || sa === undefined) return true;
  if (typeof sa !== "object") return false;
  const o = sa as Record<string, unknown>;
  const complete =
    String(o.street ?? "").trim() &&
    String(o.city ?? "").trim() &&
    String(o.state ?? "").trim() &&
    String(o.zip ?? "").trim();
  return !complete;
}
