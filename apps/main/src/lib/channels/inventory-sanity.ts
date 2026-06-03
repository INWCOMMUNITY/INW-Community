/** Reject absurd stock values from sync loops, corrupt baselines, or bad API reads. */
export const MAX_SANE_INVENTORY_QTY = 10_000;

export function isSaneInventoryQty(qty: number): boolean {
  return Number.isFinite(qty) && qty >= 0 && qty <= MAX_SANE_INVENTORY_QTY && Number.isInteger(qty);
}

export function clampSaneInventoryQty(qty: number): number | null {
  if (!Number.isFinite(qty)) return null;
  const rounded = Math.max(0, Math.round(qty));
  if (rounded > MAX_SANE_INVENTORY_QTY) return null;
  return rounded;
}

export function assertSaneInventoryQty(qty: number, context: string): number {
  const sane = clampSaneInventoryQty(qty);
  if (sane == null) {
    throw new Error(
      `${context}: quantity ${qty} is out of range (0–${MAX_SANE_INVENTORY_QTY}). Refuse sync to protect inventory.`
    );
  }
  return sane;
}

/** Baseline qty above this is treated as corrupt (e.g. inflation loop) and reset on diagnose/health. */
export function isCorruptBaselineQty(baselineQty: number | null | undefined): boolean {
  return baselineQty != null && (!Number.isFinite(baselineQty) || baselineQty > MAX_SANE_INVENTORY_QTY);
}

export function sanitizeBaselineQty(
  baselineQty: number | null | undefined,
  inwQty: number
): number | null {
  if (isCorruptBaselineQty(baselineQty)) {
    return clampSaneInventoryQty(inwQty);
  }
  return baselineQty ?? null;
}
