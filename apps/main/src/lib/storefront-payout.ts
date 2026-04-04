/**
 * Marketplace facilitator payout math (hosted Checkout on the **platform** account).
 *
 * **What stays on the platform Stripe balance (never transferred to Connect):**
 * 1. **Stripe Tax** — `session.total_details.amount_tax` is allocated per order (`taxCents`) for remittance;
 *    it was never part of `sellerTransferCents` (transfers use pre-tax `order.totalCents` minus withholdings).
 * 2. **Sales Tax Reserve** — 1% of **item subtotal only** (`order.subtotalCents`), Terms §7.9.5 (excludes shipping & local delivery fee lines).
 * 3. **Platform / processing fee** — optional extra cut of pre-tax `order.totalCents` (default **none**).
 *    Set e.g. `NWC_MARKETPLACE_PLATFORM_FEE_PERCENT=0.05` and `NWC_MARKETPLACE_PLATFORM_FEE_MIN_CENTS=50` to withhold
 *    a platform fee in addition to the 1% reserve.
 *
 * **Connect transfer:** `sellerTransferCents` = `order.totalCents - platformFeeCents - salesTaxReserveCents` (≥ 0).
 */

/** Default: no extra platform fee; only the 1% reserve is withheld from the seller transfer (tax never transferred). */
export const DEFAULT_MARKETPLACE_PLATFORM_FEE_PERCENT = 0;
export const DEFAULT_MARKETPLACE_PLATFORM_FEE_MIN_CENTS = 0;

function marketplacePlatformFeePercentFromEnv(): number {
  const raw = process.env.NWC_MARKETPLACE_PLATFORM_FEE_PERCENT?.trim();
  if (raw === undefined || raw === "") return DEFAULT_MARKETPLACE_PLATFORM_FEE_PERCENT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MARKETPLACE_PLATFORM_FEE_PERCENT;
}

function marketplacePlatformFeeMinCentsFromEnv(): number {
  const raw = process.env.NWC_MARKETPLACE_PLATFORM_FEE_MIN_CENTS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_MARKETPLACE_PLATFORM_FEE_MIN_CENTS;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MARKETPLACE_PLATFORM_FEE_MIN_CENTS;
}

/** 1% of item subtotal only (Terms §7.9.5) */
export function computeSalesTaxReserveCents(itemSubtotalCents: number): number {
  if (itemSubtotalCents <= 0) return 0;
  return Math.floor(itemSubtotalCents * 0.01);
}

/** Configurable % of pre-tax order total (shipping/local fee lines included), with minimum when percent is positive. */
export function computePlatformFeeCents(preTaxOrderTotalCents: number): number {
  if (preTaxOrderTotalCents <= 0) return 0;
  const pct = marketplacePlatformFeePercentFromEnv();
  if (pct <= 0) return 0;
  const minCents = marketplacePlatformFeeMinCentsFromEnv();
  return Math.max(minCents, Math.floor(preTaxOrderTotalCents * pct));
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

/** Pre-transfer guard: pre-tax split must consume the full order total (tax is handled separately on the session). */
export function assertPreTaxSplitMatchesOrderTotal(
  order: { id: string; totalCents: number },
  split: { platformFeeCents: number; salesTaxReserveCents: number; sellerTransferCents: number }
): void {
  const sum = split.platformFeeCents + split.salesTaxReserveCents + split.sellerTransferCents;
  if (sum !== order.totalCents) {
    throw new Error(
      `[storefront-payout] Order ${order.id}: platformFee+reserve+transfer (${sum}) !== totalCents (${order.totalCents})`
    );
  }
}

/** Stripe Checkout `amount_subtotal` must equal the sum of pending order totals (pre-tax) for this session. */
export function assertSessionSubtotalMatchesOrderTotals(
  orders: { id: string; totalCents: number }[],
  sessionAmountSubtotalCents: number | null | undefined
): void {
  const sub = sessionAmountSubtotalCents ?? 0;
  const sumOrders = orders.reduce((acc, o) => acc + o.totalCents, 0);
  if (sumOrders !== sub) {
    throw new Error(
      `[storefront-payout] amount_subtotal (${sub}) !== sum(order.totalCents) (${sumOrders}); order ids: ${orders.map((o) => o.id).join(",")}`
    );
  }
}
