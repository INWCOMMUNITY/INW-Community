/** True when the Shopify order should decrement pooled INW inventory. */
export function isShopifySaleOrder(order: {
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  financial_status?: string | null;
}): boolean {
  if (order.cancelled_at || order.cancel_reason) return false;
  const fs = (order.financial_status || "").toLowerCase();
  if (fs === "voided" || fs === "refunded") return false;
  return fs === "paid" || fs === "partially_paid" || fs === "authorized";
}
