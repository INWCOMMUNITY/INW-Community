import { CHANNEL_PROVIDER_LABELS } from "./provider-ui";
import { readRemoteDeletedNotice } from "./listing-link-flags";
import { isEbayPhotoHostFamilySyncError } from "./ebay/errors";

export const SELLER_CHANNEL_LINK_SELECT = {
  provider: true,
  syncStatus: true,
  syncEnabled: true,
  externalListingId: true,
  syncError: true,
  conflictDetails: true,
  connection: { select: { status: true } },
} as const;

export function listingChannelSyncWarning(link: {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  syncError?: string | null;
  connectionStatus?: string | null;
}): string | null {
  const label = CHANNEL_PROVIDER_LABELS[link.provider] ?? link.provider;
  if (link.connectionStatus === "disconnected") {
    return `Not syncing to ${label} — store disconnected. Reconnect in Sync Stores.`;
  }
  if (link.connectionStatus === "error") {
    return `Not syncing to ${label} — reconnect in Sync Stores.`;
  }
  if (!link.syncEnabled) return `${label} sync is paused.`;
  if (link.syncStatus === "error") {
    if (link.provider === "ebay" && isEbayPhotoHostFamilySyncError(link.syncError)) {
      return null;
    }
    const detail = link.syncError?.trim();
    return detail ? `${label}: ${detail}` : `Not syncing to ${label}.`;
  }
  return null;
}

export function withListingChannelSyncWarning(link: {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  externalListingId: string;
  syncError?: string | null;
  conflictDetails?: unknown;
  connection?: { status: string } | null;
}) {
  const connectionStatus = link.connection?.status ?? "active";
  const notice = readRemoteDeletedNotice(link.conflictDetails);
  // Hide the shop tag after a remote delete, including after "Keep on INW".
  // Pending-only hid the tag until Keep, then the green Wix pill came back.
  const remoteDeletedProvider = notice ? notice.provider : null;
  return {
    provider: link.provider,
    syncStatus: link.syncStatus,
    syncEnabled: link.syncEnabled,
    externalListingId: link.externalListingId,
    syncError: link.syncError ?? null,
    connectionStatus,
    remoteDeletedProvider,
    syncWarning: listingChannelSyncWarning({
      provider: link.provider,
      syncStatus: link.syncStatus,
      syncEnabled: link.syncEnabled,
      syncError: link.syncError,
      connectionStatus,
    }),
  };
}
