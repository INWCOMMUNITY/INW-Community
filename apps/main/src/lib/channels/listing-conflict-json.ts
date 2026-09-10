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
