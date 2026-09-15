export type DisconnectDeleteMode = "none" | "exclusive" | "all";

export type ChannelLinkOverlapRow = {
  connectionId: string;
  storeItemId: string;
  connectionStatus: string;
};

export function parseDeleteInwMode(raw: string | null): DisconnectDeleteMode {
  if (raw === "1" || raw === "true" || raw === "all") return "all";
  if (raw === "exclusive" || raw === "keepShared") return "exclusive";
  return "none";
}

export function deleteInwQuery(mode: DisconnectDeleteMode): string {
  if (mode === "all") return "?deleteInwItems=1";
  if (mode === "exclusive") return "?deleteInwItems=exclusive";
  return "";
}

/** True when another live store still tracks this listing. Disconnected stores do not count. */
export function isLiveConnectionStatus(status: string): boolean {
  return status !== "disconnected";
}

/**
 * Shopify offline tokens cannot refresh, so `error` means reconnect — keep listing
 * links, but do not ingest webhooks, cron-reconcile, or push. Other providers may
 * still recover from `error` via refresh.
 */
export function shouldSkipChannelSync(
  status: string | null | undefined,
  provider?: string | null
): boolean {
  if (status === "disconnected" || status === "revoked") return true;
  if (provider === "shopify" && status !== "active") return true;
  return false;
}

export function shouldDropRetryForDisconnectedConnection(
  status: string | null | undefined,
  provider?: string | null
): boolean {
  return shouldSkipChannelSync(status, provider);
}

/**
 * Split a connection's linked INW items into those only on this store vs also on
 * another connected store.
 */
export function countLinkedOverlap(
  connectionId: string,
  links: ChannelLinkOverlapRow[]
): { linkedOnlyThisChannel: number; linkedAlsoOnOthers: number } {
  const thisItems = new Set(
    links.filter((l) => l.connectionId === connectionId).map((l) => l.storeItemId)
  );
  const liveOtherItems = new Set(
    links
      .filter(
        (l) => l.connectionId !== connectionId && isLiveConnectionStatus(l.connectionStatus)
      )
      .map((l) => l.storeItemId)
  );
  let linkedAlsoOnOthers = 0;
  for (const id of thisItems) {
    if (liveOtherItems.has(id)) linkedAlsoOnOthers += 1;
  }
  return {
    linkedOnlyThisChannel: thisItems.size - linkedAlsoOnOthers,
    linkedAlsoOnOthers,
  };
}

export function exclusiveAndSharedIds(
  thisConnectionItemIds: string[],
  otherLiveItemIds: Set<string>
): { exclusiveIds: string[]; sharedIds: string[] } {
  const exclusiveIds: string[] = [];
  const sharedIds: string[] = [];
  for (const id of thisConnectionItemIds) {
    if (otherLiveItemIds.has(id)) sharedIds.push(id);
    else exclusiveIds.push(id);
  }
  return { exclusiveIds, sharedIds };
}

export function storeItemIdsToDelete(
  mode: DisconnectDeleteMode,
  exclusiveIds: string[],
  allIds: string[]
): string[] {
  if (mode === "none") return [];
  if (mode === "exclusive") return exclusiveIds;
  return allIds;
}

export function listingsLabel(count: number): string {
  return count === 1 ? "1 listing" : `${count} listings`;
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
