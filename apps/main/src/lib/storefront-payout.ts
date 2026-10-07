/**
 * Marketplace facilitator payout math (hosted Checkout on the **marketplace** platform account).
 *
 * **What stays on the platform Stripe balance (never transferred to Connect):**
 * 1. **Stripe Tax** (buyer-paid sales tax) — `session.total_details.amount_tax` is allocated per order
 *    (`taxCents`) for remittance; it was never part of `sellerTransferCents`.
 * 2. **Sales Tax Reserve** — 1% of **item subtotal only** (`order.subtotalCents`), Terms §7.9.5.
 * 3. **Card processing fee (seller-paid)** — Stripe bills the platform; we withhold ~2.9% + $0.30 of the
 *    full buyer charge (pre-tax order total + tax) from the seller transfer.
 * 4. **Stripe Tax product fee (seller-paid)** — Stripe Tax on Checkout is **0.5% of transaction volume**
 *    (including tax) in registered jurisdictions; Stripe deducts it from the platform balance. We withhold
 *    the same estimate from the seller when `taxCents > 0`.
 * 5. **Optional platform fee** — extra cut of pre-tax `order.totalCents` (default **none**).
 *
 * **Connect transfer:** `sellerTransferCents` =
 *   `order.totalCents - optionalPlatformFee - processingFee - stripeTaxProductFee - salesTaxReserve` (≥ 0).
 *
 * Persisted `StoreOrder.platformFeeCents` = optional + processing + Stripe Tax product fee
 * (combined withhold besides reserve).
 */

/** Default: no extra discretionary platform fee; processing + tax-product fee + 1% reserve are withheld. */
export const DEFAULT_MARKETPLACE_PLATFORM_FEE_PERCENT = 0;
export const DEFAULT_MARKETPLACE_PLATFORM_FEE_MIN_CENTS = 0;

/** US card rate used to estimate Stripe’s fee on the buyer charge (seller bears this via a smaller transfer). */
export const STRIPE_CARD_FEE_PERCENT = 0.029;
export const STRIPE_CARD_FEE_FIXED_CENTS = 30;

/**
 * Stripe Tax Basic (Checkout / no-code): 0.5% of volume where you are registered to collect tax.
 * @see https://stripe.com/tax/pricing
 * @see https://support.stripe.com/questions/understanding-stripe-tax-pricing
 */
export const STRIPE_TAX_PRODUCT_FEE_PERCENT = 0.005;

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
export function computeOptionalPlatformFeeCents(preTaxOrderTotalCents: number): number {
  if (preTaxOrderTotalCents <= 0) return 0;
  const pct = marketplacePlatformFeePercentFromEnv();
  if (pct <= 0) return 0;
  const minCents = marketplacePlatformFeeMinCentsFromEnv();
  return Math.max(minCents, Math.floor(preTaxOrderTotalCents * pct));
}

/** @deprecated Use computeOptionalPlatformFeeCents — name kept for older call sites. */
export function computePlatformFeeCents(preTaxOrderTotalCents: number): number {
  return computeOptionalPlatformFeeCents(preTaxOrderTotalCents);
}

/**
 * Estimated Stripe card processing fee on the full buyer charge (items + shipping + tax).
 * Withheld from the seller transfer so the seller pays processing; Stripe still bills the platform.
 */
export function computeStripeProcessingFeeCents(chargeCents: number): number {
  if (chargeCents <= 0) return 0;
  return Math.floor(chargeCents * STRIPE_CARD_FEE_PERCENT) + STRIPE_CARD_FEE_FIXED_CENTS;
}

/**
 * Estimated Stripe Tax *product* fee (not the sales tax remitted to the state).
 * Checkout / no-code: 0.5% of full transaction volume including tax, only when tax was collected.
 */
export function computeStripeTaxProductFeeCents(chargeCents: number, taxCents: number): number {
  if (taxCents <= 0 || chargeCents <= 0) return 0;
  return Math.floor(chargeCents * STRIPE_TAX_PRODUCT_FEE_PERCENT);
}

export type SellerTransferSplit = {
  /** Optional discretionary % fee only (env). */
  optionalPlatformFeeCents: number;
  /** Card processing withheld from seller (2.9% + $0.30 of pre-tax + tax). */
  processingFeeCents: number;
  /** Stripe Tax product fee withheld from seller (0.5% of pre-tax + tax when tax > 0). */
  stripeTaxProductFeeCents: number;
  /**
   * Persisted on StoreOrder.platformFeeCents:
   * optionalPlatformFeeCents + processingFeeCents + stripeTaxProductFeeCents.
   */
  platformFeeCents: number;
  salesTaxReserveCents: number;
  sellerTransferCents: number;
};

export function computeSellerTransferCents(
  preTaxOrderTotalCents: number,
  itemSubtotalCents: number,
  taxCents: number = 0
): SellerTransferSplit {
  const optionalPlatformFeeCents = computeOptionalPlatformFeeCents(preTaxOrderTotalCents);
  const chargeCents = Math.max(0, preTaxOrderTotalCents) + Math.max(0, taxCents);
  const processingFeeCents = computeStripeProcessingFeeCents(chargeCents);
  const stripeTaxProductFeeCents = computeStripeTaxProductFeeCents(chargeCents, taxCents);
  const platformFeeCents = optionalPlatformFeeCents + processingFeeCents + stripeTaxProductFeeCents;
  const salesTaxReserveCents = computeSalesTaxReserveCents(itemSubtotalCents);
  const sellerTransferCents = Math.max(
    0,
    preTaxOrderTotalCents - platformFeeCents - salesTaxReserveCents
  );
  return {
    optionalPlatformFeeCents,
    processingFeeCents,
    stripeTaxProductFeeCents,
    platformFeeCents,
    salesTaxReserveCents,
    sellerTransferCents,
  };
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
