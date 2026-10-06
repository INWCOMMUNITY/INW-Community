/**
 * Three-way semantic content classifier for Wix ↔ INW.
 * Fingerprints only — never wall-clock timestamps for winner selection.
 */
export type WixContentSemanticClass =
  | "UNCHANGED"
  | "CONVERGED"
  | "LOCAL_ONLY"
  | "REMOTE_ONLY"
  | "CONFLICT";

export type ClassifyWixContentSemanticsInput = {
  base: string | null;
  local: string;
  remote: string;
  hasLocalSemanticEdit?: boolean;
};

export function classifyWixContentSemantics(
  input: ClassifyWixContentSemanticsInput
): WixContentSemanticClass {
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
