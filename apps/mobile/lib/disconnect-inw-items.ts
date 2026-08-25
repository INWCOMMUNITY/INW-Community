export type DisconnectDeleteMode = "none" | "exclusive" | "all";

export function listingsLabel(count: number): string {
  return count === 1 ? "1 listing" : `${count} listings`;
}

export function deleteInwQuery(mode: DisconnectDeleteMode): string {
  if (mode === "all") return "?deleteInwItems=1";
  if (mode === "exclusive") return "?deleteInwItems=exclusive";
  return "";
}

export function overlapCounts(conn: {
  linkedListings: number;
  linkedOnlyThisChannel?: number;
  linkedAlsoOnOthers?: number;
}): { linked: number; onlyThis: number; alsoOthers: number } {
  const linked = conn.linkedListings;
  const alsoOthers = Math.min(Math.max(0, conn.linkedAlsoOnOthers ?? 0), linked);
  const onlyThis =
    conn.linkedOnlyThisChannel != null
      ? Math.min(Math.max(0, conn.linkedOnlyThisChannel), linked)
      : Math.max(0, linked - alsoOthers);
  return { linked, onlyThis, alsoOthers };
}

export function disconnectSuccessMessage(
  name: string,
  mode: DisconnectDeleteMode,
  counts: { deletedInwCount?: number; keptInwCount?: number }
): string {
  if (mode === "none") {
    return `${name} disconnected. Your INW listings are unchanged.`;
  }
  const deleted = counts.deletedInwCount ?? 0;
  const kept = counts.keptInwCount ?? 0;
  if (mode === "exclusive") {
    return `${name} disconnected. ${listingsLabel(deleted)} that ${deleted === 1 ? "was" : "were"} only on ${name} ${deleted === 1 ? "was" : "were"} removed from INW. ${listingsLabel(kept)} also on other stores ${kept === 1 ? "was" : "were"} kept.`;
  }
  return `${name} disconnected. ${listingsLabel(deleted)} removed from INW Community. Marketplace listings were not removed.`;
}
