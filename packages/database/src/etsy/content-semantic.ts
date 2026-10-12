/**
 * Three-way semantic content classifier for Etsy ↔ INW.
 * Fingerprints first; wall-clock LWW breaks CONFLICT so the most recent edit wins.
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

/**
 * Most-recent-edit wins. Remote observation time vs local desire time.
 * Missing local desire ⇒ remote wins. Ties prefer remote (marketplace observation).
 */
export function etsyRemoteWinsLastWrite(
  remoteUpdatedAt: Date | null | undefined,
  localDesiredAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  const remoteMs =
    remoteUpdatedAt instanceof Date && !Number.isNaN(remoteUpdatedAt.getTime())
      ? remoteUpdatedAt.getTime()
      : now.getTime();
  if (!(localDesiredAt instanceof Date) || Number.isNaN(localDesiredAt.getTime())) {
    return true;
  }
  return remoteMs >= localDesiredAt.getTime();
}

/** Resolve fingerprint CONFLICT with LWW — never leave dual-divergence stuck. */
export function resolveEtsyContentClassWithLww(
  cls: EtsyContentSemanticClass,
  input: {
    remoteUpdatedAt?: Date | null;
    localDesiredAt?: Date | null;
    now?: Date;
  }
): Exclude<EtsyContentSemanticClass, "CONFLICT"> {
  if (cls !== "CONFLICT") return cls;
  return etsyRemoteWinsLastWrite(input.remoteUpdatedAt, input.localDesiredAt, input.now)
    ? "REMOTE_ONLY"
    : "LOCAL_ONLY";
}
