/**
 * Server-side shipping for storefront checkout. Never trust client `shippingCostCents`.
 */
export function shippingCentsForSellerLines(
  sellerItems: Array<{ storeItemId: string; quantity: number; fulfillmentType?: string }>,
  itemMap: Map<string, { shippingCostCents?: number | null }>
): number {
  let cents = 0;
  for (const line of sellerItems) {
    if ((line.fulfillmentType ?? "ship") !== "ship") continue;
    const unit = itemMap.get(line.storeItemId)?.shippingCostCents;
    if (unit != null && unit > 0 && line.quantity > 0) {
      cents += unit * line.quantity;
    }
  }
  return cents;
}
