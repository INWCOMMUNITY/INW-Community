/** Prisma-free conflictDetails helpers so seller-hub client pages can import them. */

export type RemoteDeletedNotice = {
  provider: string;
  detectedAt: string;
  dismissedAt?: string;
};

export function conflictDetailsAsObject(conflictDetails: unknown): Record<string, unknown> {
  let value = conflictDetails;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function readRemoteDeletedNotice(conflictDetails: unknown): RemoteDeletedNotice | null {
  const raw = conflictDetailsAsObject(conflictDetails).remoteDeleted;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as { provider?: unknown; detectedAt?: unknown; dismissedAt?: unknown };
  if (typeof rec.provider !== "string" || !rec.provider.trim()) return null;
  return {
    provider: rec.provider.trim(),
    detectedAt: typeof rec.detectedAt === "string" ? rec.detectedAt : "",
    ...(typeof rec.dismissedAt === "string" && rec.dismissedAt ? { dismissedAt: rec.dismissedAt } : {}),
  };
}

export type RemoteCatalogState =
  | "inactive"
  | "inactive_outside_catalog"
  | "linked_other_channel";

export function readEbayListingEnded(conflictDetails: unknown): boolean {
  return conflictDetailsAsObject(conflictDetails).ebayListingEnded === true;
}

/** Title GetItem last confirmed. Do not stamp this on outbound PUT — GetItem can lag. */
export function readEbayLastSyncedTitle(conflictDetails: unknown): string | null {
  const value = conflictDetailsAsObject(conflictDetails).ebayLastSyncedTitle;
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title ? title : null;
}

export function withEbayLastSyncedTitle(
  conflictDetails: unknown,
  title: string | null
): Record<string, unknown> {
  const base = conflictDetailsAsObject(conflictDetails);
  const trimmed = title?.trim().slice(0, 200) ?? "";
  if (!trimmed) delete base.ebayLastSyncedTitle;
  else base.ebayLastSyncedTitle = trimmed;
  return base;
}

/**
 * Fingerprint of the per-variation prices we last successfully pushed to this channel.
 * Lets outbound detect a per-variation price edit (listing-level price unchanged) and route it
 * through a full listing push rather than the quantity-only inventory path.
 */
export function readLastPushedVariantPricesHash(conflictDetails: unknown): string | null {
  const value = conflictDetailsAsObject(conflictDetails).lastPushedVariantPricesHash;
  return typeof value === "string" && value ? value : null;
}

export function withLastPushedVariantPricesHash(
  conflictDetails: unknown,
  hash: string | null
): Record<string, unknown> {
  const base = conflictDetailsAsObject(conflictDetails);
  if (hash && hash.trim()) base.lastPushedVariantPricesHash = hash;
  else delete base.lastPushedVariantPricesHash;
  return base;
}

/**
 * Title + listing price we last successfully pushed to Etsy. Lets the outbound guard tell an
 * INDEPENDENT seller edit on Etsy (live content moved off this baseline) apart from Etsy simply
 * echoing our own prior push, so a fresh INW/fan-out edit is not blocked on timestamp alone.
 */
export function readEtsyLastSyncedContent(conflictDetails: unknown): {
  title: string | null;
  priceCents: number | null;
} {
  const obj = conflictDetailsAsObject(conflictDetails);
  const title = typeof obj.etsyLastSyncedTitle === "string" ? obj.etsyLastSyncedTitle : null;
  const priceCents =
    typeof obj.etsyLastSyncedPriceCents === "number" ? obj.etsyLastSyncedPriceCents : null;
  return { title, priceCents };
}

export function withEtsyLastSyncedContent(
  conflictDetails: unknown,
  args: { title: string | null; priceCents: number | null }
): Record<string, unknown> {
  const base = conflictDetailsAsObject(conflictDetails);
  if (args.title != null) base.etsyLastSyncedTitle = args.title;
  if (args.priceCents != null) base.etsyLastSyncedPriceCents = args.priceCents;
  return base;
}

/**
 * ISO timestamp of the last inventory-only push from syncInventoryToChannels.
 * Used by Shopify webhook echo detection to suppress products/update and
 * inventory_levels/update echoes of our own push (since the qty-only path
 * intentionally does not stamp lastPushedAt).
 */
export function readLastInventoryPushAt(conflictDetails: unknown): Date | null {
  const value = conflictDetailsAsObject(conflictDetails).lastInventoryPushAt;
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function withLastInventoryPushAt(
  conflictDetails: unknown,
  date: Date
): Record<string, unknown> {
  const base = conflictDetailsAsObject(conflictDetails);
  base.lastInventoryPushAt = date.toISOString();
  return base;
}

export function readRemoteCatalogState(conflictDetails: unknown): RemoteCatalogState | null {
  const value = conflictDetailsAsObject(conflictDetails).remoteCatalogState;
  if (
    value === "inactive" ||
    value === "inactive_outside_catalog" ||
    value === "linked_other_channel"
  ) {
    return value;
  }
  return null;
}
