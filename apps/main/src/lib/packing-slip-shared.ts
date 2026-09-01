/** Shared packing-slip types and display math (safe for client + server). */

export const PACKING_SLIP_FOOTER = "inwcommunity.com";
export const PACKING_SLIP_THANKS = "Thank you for supporting locally owned businesses";

export interface PackingSlipOrder {
  id: string;
  shippingAddress: unknown;
  createdAt?: string | Date;
  stripePaymentIntentId?: string | null;
  orderKind?: string | null;
}

export interface PackingSlipGroup {
  buyer: { firstName: string; lastName: string; email: string };
  orders: PackingSlipOrder[];
  combinedItems: Array<{
    id: string;
    quantity: number;
    priceCentsAtPurchase: number;
    storeItem: { title: string };
    orderId: string;
  }>;
  totalCents: number;
  subtotalCents: number;
  shippingCostCents: number;
  taxCents?: number;
}

export interface PackingSlipSellerProfile {
  business: {
    name: string;
    phone: string | null;
    address: string | null;
    city?: string | null;
    logoUrl: string | null;
    website?: string | null;
    email?: string | null;
  } | null;
  /** Return/ship-from address (from Shippo Address Book when generating slip). */
  returnAddressFormatted?: string | null;
  packingSlipNote?: string | null;
}

export type PackingSlipTotalRow = {
  label: string;
  value: string;
  emphasis?: boolean;
};

/** Buyer-facing grand total. Stored `totalCents` is pre-tax by design. */
export function packingSlipGrandTotalCents(group: {
  totalCents: number;
  taxCents?: number | null;
}): number {
  return Math.max(0, group.totalCents + (group.taxCents ?? 0));
}

/** Local delivery fee is in `totalCents` but not `shippingCostCents`. */
export function packingSlipLocalDeliveryCents(group: {
  totalCents: number;
  subtotalCents: number;
  shippingCostCents: number;
}): number {
  return Math.max(0, group.totalCents - group.subtotalCents - group.shippingCostCents);
}

export function formatPackingSlipMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatPackingSlipOrderRef(id: string): string {
  return `#${id.slice(-8).toUpperCase()}`;
}

export function formatPackingSlipDate(value?: string | Date): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function earliestPackingSlipDate(orders: PackingSlipOrder[]): string {
  let min = Number.POSITIVE_INFINITY;
  let best: string | Date | undefined;
  for (const o of orders) {
    if (!o.createdAt) continue;
    const t = (o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt)).getTime();
    if (!Number.isNaN(t) && t < min) {
      min = t;
      best = o.createdAt;
    }
  }
  return formatPackingSlipDate(best);
}

export function packingSlipPaymentLabel(
  orders: Array<{ stripePaymentIntentId?: string | null; orderKind?: string | null }>,
  groupTotalCents: number
): string {
  if (
    orders.length > 0 &&
    orders.every((o) => o.orderKind === "reward_redemption") &&
    groupTotalCents === 0
  ) {
    return "Reward";
  }
  if (orders.some((o) => o.stripePaymentIntentId)) return "Paid";
  return "Cash due";
}

export function packingSlipOrderMetaLine(group: PackingSlipGroup): string {
  const refs = group.orders.map((o) => formatPackingSlipOrderRef(o.id)).join(", ");
  const label = group.orders.length > 1 ? `Orders ${refs}` : `Order ${refs}`;
  const date = earliestPackingSlipDate(group.orders);
  const pay = packingSlipPaymentLabel(group.orders, group.totalCents);
  return [label, date, pay].filter(Boolean).join("  ·  ");
}

export function formatPackingSlipWebsite(url?: string | null): string {
  if (!url?.trim()) return "";
  return url.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export function packingSlipContactLine(business: PackingSlipSellerProfile["business"]): string {
  if (!business) return "";
  return [formatPackingSlipWebsite(business.website), business.email, business.phone]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join("  ·  ");
}

export function packingSlipTotalRows(
  group: Pick<PackingSlipGroup, "subtotalCents" | "shippingCostCents" | "totalCents" | "taxCents">
): PackingSlipTotalRow[] {
  const rows: PackingSlipTotalRow[] = [
    { label: "Subtotal", value: formatPackingSlipMoney(group.subtotalCents) },
  ];
  rows.push({
    label: "Shipping",
    value: group.shippingCostCents > 0 ? formatPackingSlipMoney(group.shippingCostCents) : "Free",
  });
  const local = packingSlipLocalDeliveryCents(group);
  if (local > 0) {
    rows.push({ label: "Local delivery", value: formatPackingSlipMoney(local) });
  }
  if ((group.taxCents ?? 0) > 0) {
    rows.push({ label: "Tax", value: formatPackingSlipMoney(group.taxCents ?? 0) });
  }
  rows.push({
    label: "Total",
    value: formatPackingSlipMoney(packingSlipGrandTotalCents(group)),
    emphasis: true,
  });
  return rows;
}
