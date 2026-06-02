import { prisma } from "database";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getConnectionContext } from "./connection";
import { importRemoteListing } from "./import-listing";
import { getAdapter } from "./registry";
import type { ChannelProvider } from "./types";

type ConnectionRow = {
  id: string;
  memberId: string;
  provider: string;
  externalShopId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  status: string;
  etsyShippingProfileId: string | null;
  config?: unknown;
};

function autoImportEnabled(provider: ChannelProvider, config: Record<string, unknown> | null): boolean {
  if (config?.autoImportInbound === false) return false;
  // Wix → INW: new products on the Wix site become storefront listings automatically.
  return provider === "wix";
}

/**
 * Import Wix catalog products that are not yet linked to an INW StoreItem (cron / post-connect).
 */
export async function reconcileConnectionInboundListings(
  connection: ConnectionRow
): Promise<{ imported: number }> {
  const provider = connection.provider as ChannelProvider;
  if (!autoImportEnabled(provider, connection.config as Record<string, unknown> | null)) {
    return { imported: 0 };
  }

  const ctx = await getConnectionContext(connection);
  if (!ctx) return { imported: 0 };

  const canList = await memberHasStorefrontListingAccess(connection.memberId);
  if (!canList) return { imported: 0 };

  let listings;
  try {
    listings = await getAdapter(provider).listRemoteListings(ctx);
  } catch (e) {
    console.error("[channels] inbound listRemoteListings failed", { provider, error: String(e) });
    return { imported: 0 };
  }

  const linked = await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider },
    select: { externalListingId: true },
  });
  const linkedSet = new Set(linked.map((l) => l.externalListingId));

  let imported = 0;
  for (const listing of listings) {
    if (linkedSet.has(listing.externalListingId)) continue;
    const result = await importRemoteListing({
      memberId: connection.memberId,
      connectionId: connection.id,
      provider,
      listing,
      externalShopId: ctx.externalShopId,
      postToFeed: true,
    });
    if (result.ok) imported += 1;
  }

  if (imported > 0) {
    console.info("[channels] inbound import", { provider, connectionId: connection.id, imported });
  }
  return { imported };
}
