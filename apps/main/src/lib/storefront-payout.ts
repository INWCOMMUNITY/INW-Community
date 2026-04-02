/** Marketplace facilitator payout math (pre-tax order total, platform fee, Sales Tax Reserve). */

export const PLATFORM_FEE_PERCENT = 0.05;
export const PLATFORM_FEE_MIN_CENTS = 50;

/** 1% of item subtotal only (Terms §7.9.5) */
export function computeSalesTaxReserveCents(itemSubtotalCents: number): number {
  if (itemSubtotalCents <= 0) return 0;
  return Math.floor(itemSubtotalCents * 0.01);
}

/** 5% of pre-tax order total, minimum 50¢ */
export function computePlatformFeeCents(preTaxOrderTotalCents: number): number {
  if (preTaxOrderTotalCents <= 0) return 0;
  return Math.max(PLATFORM_FEE_MIN_CENTS, Math.floor(preTaxOrderTotalCents * PLATFORM_FEE_PERCENT));
}

export function computeSellerTransferCents(
  preTaxOrderTotalCents: number,
  itemSubtotalCents: number
): { platformFeeCents: number; salesTaxReserveCents: number; sellerTransferCents: number } {
  const platformFeeCents = computePlatformFeeCents(preTaxOrderTotalCents);
  const salesTaxReserveCents = computeSalesTaxReserveCents(itemSubtotalCents);
  const sellerTransferCents = Math.max(0, preTaxOrderTotalCents - platformFeeCents - salesTaxReserveCents);
  return { platformFeeCents, salesTaxReserveCents, sellerTransferCents };
}

/**
 * Split session sales tax across orders by each order's share of pre-tax subtotal.
 * Uses amount_subtotal (not amount_total) so proportions match line items before tax.
 */
export function allocateTaxCentsAcrossOrders(
  orders: { id: string; totalCents: number }[],
  sessionAmountSubtotalCents: number,
  sessionTaxCents: number
): Map<string, number> {
  const out = new Map<string, number>();
  if (sessionTaxCents <= 0 || sessionAmountSubtotalCents <= 0) {
    for (const o of orders) out.set(o.id, 0);
    return out;
  }
  let allocated = 0;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]!;
    const isLast = i === orders.length - 1;
    const share = isLast
      ? sessionTaxCents - allocated
      : Math.round((o.totalCents / sessionAmountSubtotalCents) * sessionTaxCents);
    allocated += share;
    out.set(o.id, Math.max(0, share));
  }
  return out;
}
