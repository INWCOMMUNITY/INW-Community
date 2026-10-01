/**
 * Three-way semantic content classifier for Etsy ↔ INW.
 * Fingerprints only — never wall-clock timestamps for winner selection.
 */
export type EtsyContentSemanticClass =
  | "UNCHANGED"
  | "CONVERGED"
  | "LOCAL_ONLY"
  | "REMOTE_ONLY"
  | "CONFLICT";

export type ClassifyEtsyContentSemanticsInput = {
  base: string | null;
  local: string;
  remote: string;
  hasLocalSemanticEdit?: boolean;
};

export function classifyEtsyContentSemantics(
  input: ClassifyEtsyContentSemanticsInput
): EtsyContentSemanticClass {
  const { base, local, remote } = input;
  if (local === remote) {
    if (base != null && local === base) return "UNCHANGED";
    return "CONVERGED";
  }

  if (base == null) {
    if (!input.hasLocalSemanticEdit) return "REMOTE_ONLY";
    return "CONFLICT";
  }

  if (local !== base && remote === base) return "LOCAL_ONLY";
  if (local === base && remote !== base) return "REMOTE_ONLY";
  return "CONFLICT";
}
