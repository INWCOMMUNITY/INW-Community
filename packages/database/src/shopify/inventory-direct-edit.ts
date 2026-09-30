/**
 * Direct Shopify inventory edit detection (Unit 5).
 *
 * Inventory remains a causal Foundation projection — never LWW from Shopify qty.
 * Unexplained remote quantity changes (not equal to applied base or desired) are
 * REMOTE_DRIFT and must pause outbound projection until sale evidence or seller
 * re-asserts a Foundation quantity.
 */

export type ShopifyDirectInventoryEditClass =
  | "NO_CHANGE"
  | "MATCHES_DESIRED"
  | "MATCHES_APPLIED_BASE"
  | "EXPLAINED_BY_SALE"
  | "UNEXPLAINED_REMOTE_EDIT";

export function classifyShopifyDirectInventoryEdit(input: {
  remoteAvailable: number;
  desiredAvailable: number | null;
  appliedAvailable: number | null;
  /** Optional causal sale delta already applied to Foundation (negative for sale). */
  explainedDelta?: number | null;
}): ShopifyDirectInventoryEditClass {
  const remote = input.remoteAvailable;
  if (input.desiredAvailable != null && remote === input.desiredAvailable) {
    return "MATCHES_DESIRED";
  }
  if (input.appliedAvailable != null && remote === input.appliedAvailable) {
    return "MATCHES_APPLIED_BASE";
  }
  if (
    input.appliedAvailable != null &&
    typeof input.explainedDelta === "number" &&
    remote === input.appliedAvailable + input.explainedDelta
  ) {
    return "EXPLAINED_BY_SALE";
  }
  if (input.appliedAvailable == null && input.desiredAvailable == null) {
    return "NO_CHANGE";
  }
  return "UNEXPLAINED_REMOTE_EDIT";
}

/** True when outbound PROJECT_INVENTORY must refuse mutation and surface drift. */
export function shouldPauseInventoryForDirectShopifyEdit(
  cls: ShopifyDirectInventoryEditClass
): boolean {
  return cls === "UNEXPLAINED_REMOTE_EDIT";
}
