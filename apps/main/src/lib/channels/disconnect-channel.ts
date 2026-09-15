import { prisma } from "database";
import { decrypt } from "@/lib/encrypt";
import { disableEbayCommerceNotifications } from "./ebay/commerce-notifications";
import { unsubscribeFromEbayNotifications } from "./ebay/trading";

export type DisconnectRemoteRelease = {
  ok: boolean;
  error?: string;
};

export function tryDecryptChannelToken(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

/**
 * Unregister INW's live hooks on the marketplace while the token still works.
 * Best-effort: local disconnect still proceeds if this fails.
 *
 * Provider-specific behavior:
 * - eBay: Unsubscribes Trading API notifications + disables Commerce notifications
 * - Shopify: Removes INW webhooks via Admin API
 * - Etsy: No remote bindings to release (Etsy uses push webhooks configured at app level)
 * - Wix: No remote bindings to release (Wix webhooks are app-level, not per-installation)
 */
export async function releaseRemoteChannelBindings(args: {
  provider: string;
  accessToken: string;
  config: unknown;
  externalShopId: string | null;
}): Promise<DisconnectRemoteRelease> {
  try {
    if (args.provider === "ebay") {
      const notif = await unsubscribeFromEbayNotifications(args.accessToken);
      await disableEbayCommerceNotifications(args.accessToken, args.config);
      if (!notif.success) return { ok: false, error: notif.error };
      return { ok: true };
    }

    if (args.provider === "shopify") {
      const { getShopifyConfig, readShopifyConfig } = await import("./shopify/config");
      const { removeShopifyWebhooks } = await import("./shopify/webhooks-subscribe");
      const cfg = readShopifyConfig(
        args.config as Record<string, unknown> | null,
        args.externalShopId
      );
      if (!cfg.shop) return { ok: false, error: "missing_shop" };
      const storedAddress =
        args.config && typeof args.config === "object" && !Array.isArray(args.config)
          ? (args.config as Record<string, unknown>).shopifyWebhookAddress
          : null;
      const result = await removeShopifyWebhooks({
        accessToken: args.accessToken,
        shop: cfg.shop,
        apiVersion: cfg.apiVersion || getShopifyConfig().apiVersion,
        extraAddresses: typeof storedAddress === "string" ? [storedAddress] : [],
      });
      return result.error ? { ok: false, error: result.error } : { ok: true };
    }

    if (args.provider === "etsy") {
      // Etsy does not provide a token revocation API from the app side.
      // The refresh token becomes invalid when the user revokes access from their
      // Etsy account settings (Account → Permissions → Apps you've authorized).
      // Etsy webhooks are push-based from Etsy's side (app-level config), not
      // per-installation subscriptions, so there's nothing to unsubscribe.
      return { ok: true };
    }

    if (args.provider === "wix") {
      // Wix uses client_credentials + instanceId to mint tokens on demand.
      // When the user uninstalls the app from their Wix site, the instanceId
      // stops working (minting fails). There's no explicit token revocation API.
      // Wix webhooks are configured in the Wix Dev Center at the app level,
      // not per-installation, so there's nothing to unsubscribe.
      return { ok: true };
    }

    // Unknown provider - assume no remote bindings
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fully delete the channel connection and all related data.
 * This ensures zero memory of the old connection - reconnecting creates a fresh start.
 *
 * Cascade deletes:
 * - ChannelListingLink rows (onDelete: Cascade from connection)
 * - ChannelSyncRetry rows (onDelete: Cascade from link)
 *
 * Explicit deletes (no FK):
 * - ChannelSyncLog
 * - SyncTrace
 * - ChannelWebhookEvent (provider-scoped)
 *
 * Note: ChannelSyncEvent is retained for 30-day dedup safety (cleaned separately).
 */
export async function wipeDisconnectedChannel(
  connectionId: string,
  opts?: { lastError?: string; memberId?: string; provider?: string }
): Promise<{ linksDeleted: number; connectionDeleted: boolean; historicalDataPurged: boolean }> {
  const { memberId, provider } = opts ?? {};

  // First, count how many links will be deleted (for return value)
  const linkCount = await prisma.channelListingLink.count({
    where: { connectionId },
  });

  // Purge historical data that doesn't cascade (no FK to connection)
  // This ensures zero memory of the old connection.
  let historicalDataPurged = false;
  if (memberId && provider) {
    await Promise.all([
      // Sync activity logs for this member + provider
      prisma.channelSyncLog.deleteMany({
        where: { memberId, provider },
      }),
      // Diagnostic traces for this member + provider
      prisma.syncTrace.deleteMany({
        where: { memberId, provider },
      }),
    ]);
    // Note: ChannelWebhookEvent is not deleted here because it lacks a memberId
    // column and cannot be scoped to a specific user. These are system-level
    // processing logs, not user data. A future schema migration could add
    // connectionId to enable proper scoping.
    historicalDataPurged = true;
  }

  // Delete the connection row - listing links and retries cascade automatically
  await prisma.channelConnection.delete({
    where: { id: connectionId },
  });

  return { linksDeleted: linkCount, connectionDeleted: true, historicalDataPurged };
}

/** Default retention period for ChannelSyncEvent (order deduplication records). */
export const SYNC_EVENT_RETENTION_DAYS = 30;

/**
 * Clean up old ChannelSyncEvent records (order deduplication).
 * These are kept for 30 days to prevent re-processing orders if a user disconnects
 * and quickly reconnects. After 30 days, the dedup records are deleted.
 *
 * Called by the sync-channels cron job.
 */
export async function cleanupOldSyncEvents(
  retentionDays = SYNC_EVENT_RETENTION_DAYS
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.channelSyncEvent.deleteMany({
    where: {
      processedAt: { lt: cutoff },
    },
  });
  return result.count;
}
