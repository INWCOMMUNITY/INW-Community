/**
 * Three-way semantic content classifier for Shopify ↔ INW.
 * Fingerprints only — never Shopify/INW wall-clock timestamps for winner selection.
 *
 * BASE = last verified converged applied fingerprint.
 * LOCAL = current INW desired fingerprint.
 * REMOTE = current Shopify observed fingerprint.
 *
 * Narrow rule (safe exception to exact most-recent-wins):
 * - single-sided changes since last convergence resolve automatically
 * - equal changes converge
 * - dual divergent changes cannot be causally ordered from Shopify's current
 *   provider evidence (resource-level updatedAt is not field-specific) and become CONFLICT
 */
export type ShopifyContentSemanticClass =
  | "UNCHANGED"
  | "CONVERGED"
  | "LOCAL_ONLY"
  | "REMOTE_ONLY"
  | "CONFLICT";

export type ClassifyShopifyContentSemanticsInput = {
  /** Last verified converged applied fingerprint, or null before first convergence. */
  base: string | null;
  local: string;
  remote: string;
  /**
   * Null-base bootstrap only: whether INW has recorded a relevant semantic edit
   * since mapping (desired version advanced / desiredAt set). Not a clock comparison.
   */
  hasLocalSemanticEdit?: boolean;
};

export function classifyShopifyContentSemantics(
  input: ClassifyShopifyContentSemanticsInput
): ShopifyContentSemanticClass {
  const { base, local, remote } = input;
  if (local === remote) {
    if (base != null && local === base) return "UNCHANGED";
    return "CONVERGED";
  }

  if (base == null) {
    // Insufficient shared history: only auto-take remote when INW never edited.
    if (!input.hasLocalSemanticEdit) return "REMOTE_ONLY";
    return "CONFLICT";
  }

  if (local !== base && remote === base) return "LOCAL_ONLY";
  if (local === base && remote !== base) return "REMOTE_ONLY";
  // Both diverged differently from BASE (local !== remote already).
  return "CONFLICT";
}
