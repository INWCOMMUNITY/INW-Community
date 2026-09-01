import { prisma, Prisma } from "database";

export type RemoteCatalogState =
  | "inactive"
  | "inactive_outside_catalog"
  | "linked_other_channel";

function asObject(conflictDetails: unknown): Record<string, unknown> {
  if (conflictDetails && typeof conflictDetails === "object" && !Array.isArray(conflictDetails)) {
    return { ...(conflictDetails as Record<string, unknown>) };
  }
  return {};
}

export function mergeConflictDetails(
  conflictDetails: unknown,
  patch: Record<string, unknown | null>
): Prisma.InputJsonValue {
  const base = asObject(conflictDetails);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return base as Prisma.InputJsonValue;
}

export type RemoteDeletedNotice = {
  provider: string;
  detectedAt: string;
  dismissedAt?: string;
};

export function readRemoteDeletedNotice(conflictDetails: unknown): RemoteDeletedNotice | null {
  const raw = asObject(conflictDetails).remoteDeleted;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as { provider?: unknown; detectedAt?: unknown; dismissedAt?: unknown };
  if (typeof rec.provider !== "string" || !rec.provider.trim()) return null;
  return {
    provider: rec.provider.trim(),
    detectedAt: typeof rec.detectedAt === "string" ? rec.detectedAt : "",
    ...(typeof rec.dismissedAt === "string" && rec.dismissedAt ? { dismissedAt: rec.dismissedAt } : {}),
  };
}

export function isRemoteDeletedPending(conflictDetails: unknown): boolean {
  const notice = readRemoteDeletedNotice(conflictDetails);
  return Boolean(notice && !notice.dismissedAt);
}

export function withRemoteDeletedPending(
  conflictDetails: unknown,
  provider: string,
  detectedAt = new Date().toISOString()
): Prisma.InputJsonValue {
  const existing = readRemoteDeletedNotice(conflictDetails);
  if (existing) return asObject(conflictDetails) as Prisma.InputJsonValue;
  return mergeConflictDetails(conflictDetails, {
    remoteDeleted: { provider: provider.trim(), detectedAt },
  });
}

export function withRemoteDeletedDismissed(
  conflictDetails: unknown,
  dismissedAt = new Date().toISOString()
): Prisma.InputJsonValue {
  const existing = readRemoteDeletedNotice(conflictDetails);
  if (!existing) return asObject(conflictDetails) as Prisma.InputJsonValue;
  return mergeConflictDetails(conflictDetails, {
    remoteDeleted: { ...existing, dismissedAt },
  });
}

export function withRemoteDeletedCleared(conflictDetails: unknown): Prisma.InputJsonValue {
  return mergeConflictDetails(conflictDetails, { remoteDeleted: null });
}

export async function persistRemoteDeletedPending(args: {
  linkId: string;
  conflictDetails: unknown;
  provider: string;
}): Promise<boolean> {
  const existing = readRemoteDeletedNotice(args.conflictDetails);
  if (existing) return false;
  const next = withRemoteDeletedPending(args.conflictDetails, args.provider);
  await prisma.channelListingLink.update({
    where: { id: args.linkId },
    data: { conflictDetails: next },
  });
  return true;
}

export async function persistRemoteDeletedDismissed(args: {
  linkId: string;
  conflictDetails: unknown;
}): Promise<void> {
  if (!isRemoteDeletedPending(args.conflictDetails)) return;
  await prisma.channelListingLink.update({
    where: { id: args.linkId },
    data: { conflictDetails: withRemoteDeletedDismissed(args.conflictDetails) },
  });
}

export async function clearRemoteDeletedNoticeIfSet(
  linkId: string,
  conflictDetails: unknown
): Promise<void> {
  if (!readRemoteDeletedNotice(conflictDetails)) return;
  await prisma.channelListingLink.update({
    where: { id: linkId },
    data: { conflictDetails: withRemoteDeletedCleared(conflictDetails) },
  });
}

export function isEbayListingEnded(conflictDetails: unknown): boolean {
  return asObject(conflictDetails).ebayListingEnded === true;
}

export function withEbayListingEnded(
  conflictDetails: unknown,
  ended: boolean
): Prisma.InputJsonValue {
  return mergeConflictDetails(conflictDetails, {
    ebayListingEnded: ended ? true : null,
  });
}

export function readRemoteCatalogState(
  conflictDetails: unknown
): RemoteCatalogState | null {
  const value = asObject(conflictDetails).remoteCatalogState;
  if (
    value === "inactive" ||
    value === "inactive_outside_catalog" ||
    value === "linked_other_channel"
  ) {
    return value;
  }
  return null;
}

export function withRemoteCatalogState(
  conflictDetails: unknown,
  state: RemoteCatalogState | null
): Prisma.InputJsonValue {
  return mergeConflictDetails(conflictDetails, { remoteCatalogState: state });
}

export async function persistEbayListingEnded(
  linkId: string,
  conflictDetails: unknown
): Promise<Prisma.InputJsonValue> {
  const next = withEbayListingEnded(conflictDetails, true);
  if (isEbayListingEnded(conflictDetails)) return next;
  await prisma.channelListingLink.update({
    where: { id: linkId },
    data: {
      conflictDetails: next,
      syncError: "eBay listing ended; inventory will not be revised",
    },
  });
  return next;
}

export async function persistEbayListingActive(
  linkId: string,
  conflictDetails: unknown
): Promise<Prisma.InputJsonValue> {
  const next = withEbayListingEnded(conflictDetails, false);
  if (!isEbayListingEnded(conflictDetails)) return next;
  await prisma.channelListingLink.update({
    where: { id: linkId },
    data: {
      conflictDetails: next,
      syncError: null,
    },
  });
  return next;
}

/** Persist remote catalog skip-state. Returns true when the stored state changed. */
export async function persistRemoteCatalogState(args: {
  linkId: string;
  conflictDetails: unknown;
  state: RemoteCatalogState;
}): Promise<boolean> {
  if (readRemoteCatalogState(args.conflictDetails) === args.state) return false;
  await prisma.channelListingLink.update({
    where: { id: args.linkId },
    data: {
      conflictDetails: withRemoteCatalogState(args.conflictDetails, args.state),
    },
  });
  return true;
}

export async function clearRemoteCatalogStateIfSet(
  linkId: string,
  conflictDetails: unknown
): Promise<void> {
  if (!readRemoteCatalogState(conflictDetails)) return;
  await prisma.channelListingLink.update({
    where: { id: linkId },
    data: { conflictDetails: withRemoteCatalogState(conflictDetails, null) },
  });
}

export async function markEtsyLinkInactiveAfterSellOut(args: {
  connectionId: string;
  listingId: string;
}): Promise<void> {
  const link = await prisma.channelListingLink.findFirst({
    where: {
      connectionId: args.connectionId,
      provider: "etsy",
      externalListingId: args.listingId,
    },
  });
  if (!link) return;
  await prisma.channelListingLink.update({
    where: { id: link.id },
    data: {
      syncBaselineQty: 0,
      conflictDetails: withRemoteCatalogState(link.conflictDetails, "inactive"),
    },
  });
  await prisma.channelSyncRetry.deleteMany({
    where: { linkId: link.id, retryType: "inventory" },
  });
}

/** Inventory-only after a sell-out apply; content fan-out when title/photos/etc. changed. */
export function inboundContentFanoutKind(args: {
  contentChange: boolean;
  soldOut: boolean;
}): "inventory" | "content" | null {
  if (args.soldOut) return "inventory";
  if (args.contentChange) return "content";
  return null;
}

export function shouldSkipEndedEbayOutbound(
  provider: string,
  conflictDetails: unknown
): boolean {
  return provider === "ebay" && isEbayListingEnded(conflictDetails);
}

/**
 * Drop retries that would fight recovery or revise an ended/inactive listing.
 * Etsy qty-0 jobs stay only when a recent sale still needs deactivate.
 */
export function shouldDropStaleChannelRetry(args: {
  provider: string;
  retryType: string;
  conflictDetails: unknown;
  storeItemQuantity: number | null | undefined;
  hasRecentSale: boolean;
  lastError?: string | null;
}): boolean {
  if (shouldSkipEndedEbayOutbound(args.provider, args.conflictDetails)) return true;
  if (args.provider !== "etsy" || args.retryType !== "inventory") return false;
  const state = readRemoteCatalogState(args.conflictDetails);
  if (state === "inactive" || state === "inactive_outside_catalog") return true;
  const qty = args.storeItemQuantity ?? 0;
  const zeroPushJob = /quantity is 0|expected 0|sell-?out|deactivat/i.test(args.lastError ?? "");
  if (qty > 0) return zeroPushJob;
  return !args.hasRecentSale;
}
