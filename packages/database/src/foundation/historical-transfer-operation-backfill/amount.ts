/**
 * Historical seller payout amount reconstruction.
 *
 * Production fulfill used `computeSellerTransferCents(totalCents, subtotalCents)` and
 * persisted `platformFeeCents` + `salesTaxReserveCents` on StoreOrder. Prompt 131
 * validated that sale ledger amounts equal:
 *   max(0, totalCents - platformFeeCents - salesTaxReserveCents)
 *
 * This unit uses the **durable stored split** as the single reconstruction source so
 * env fee changes cannot rewrite historical amounts. It does not re-read env.
 */

export function reconstructHistoricalSellerTransferCents(order: {
  totalCents: number;
  platformFeeCents: number;
  salesTaxReserveCents: number;
}): number {
  return Math.max(0, order.totalCents - order.platformFeeCents - order.salesTaxReserveCents);
}

export function canReconstructHistoricalSellerTransferCents(order: {
  totalCents: number | null | undefined;
  platformFeeCents: number | null | undefined;
  salesTaxReserveCents: number | null | undefined;
}): order is { totalCents: number; platformFeeCents: number; salesTaxReserveCents: number } {
  return (
    typeof order.totalCents === "number" &&
    Number.isFinite(order.totalCents) &&
    typeof order.platformFeeCents === "number" &&
    Number.isFinite(order.platformFeeCents) &&
    typeof order.salesTaxReserveCents === "number" &&
    Number.isFinite(order.salesTaxReserveCents)
  );
}
