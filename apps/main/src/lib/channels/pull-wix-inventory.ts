import { prisma } from "database";
import { applyRemoteQuantityToStoreItem } from "./apply-remote-listing";
import { applyRemoteVariantAxesToStoreItem } from "./apply-remote-meta";
import { getConnectionContext } from "./connection";
import { getAdapter } from "./registry";
import { syncInventoryToChannels } from "./sync-inventory";
import { syncContentHash, syncMetaHash } from "./sync-baseline";
import { variantsFingerprint } from "./variant-sync";
import { hasOptionQuantities } from "@/lib/store-item-variants";
import type { ChannelProvider } from "./types";

/** After a webhook-driven qty pull, record the agreed baseline so the cron doesn't re-fight it. */
async function recordInventoryBaseline(linkId: string, storeItemId: string): Promise<void> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: {
      title: true,
      description: true,
      photos: true,
      priceCents: true,
      quantity: true,
      category: true,
      subcategory: true,
      secondaryCategory: true,
      shippingCostCents: true,
      variants: true,
    },
  });
  if (!item) return;
  await prisma.channelListingLink
    .update({
      where: { id: linkId },
      data: {
        lastInboundAt: new Date(),
        syncBaselineHash: syncContentHash(item),
        syncBaselineMetaHash: syncMetaHash(item),
        syncBaselineVariantsHash: variantsFingerprint(item.variants),
        syncBaselineQty: item.quantity,
        syncBaselineAt: new Date(),
      },
    })
    .catch((e) => console.error("[channels] inventory baseline failed", { linkId, error: String(e) }));
}

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

/**
 * Pull live quantity from Wix for linked products (inventory webhooks / manual Wix edits).
 * Does not use the catalog product list (which may have stale or unknown qty).
 */
export async function pullWixInventoryForConnection(
  connection: ConnectionRow,
  productIds?: string[]
): Promise<{ updated: number }> {
  if (connection.provider !== "wix") return { updated: 0 };

  const ctx = await getConnectionContext(connection);
  if (!ctx) return { updated: 0 };

  const adapter = getAdapter("wix");
  if (!adapter.fetchProductQuantity) return { updated: 0 };

  const { fetchWixV1Product, wixV1ProductToVariants } = await import("./wix/collections");
  const { wixSiteIdFromConn } = await import("./wix/site");
  const siteId = wixSiteIdFromConn(ctx);
  const wixOpts = siteId ? { siteId } : {};

  const links = await prisma.channelListingLink.findMany({
    where: {
      connectionId: connection.id,
      provider: "wix" as ChannelProvider,
      syncEnabled: true,
      ...(productIds?.length ? { externalListingId: { in: productIds } } : {}),
    },
    select: {
      id: true,
      storeItemId: true,
      externalListingId: true,
      storeItem: { select: { variants: true } },
    },
  });

  let updated = 0;
  for (const link of links) {
    try {
      let changed: boolean;
      // Option listings: pull per-size stock (Stores v2 inventory merged into the v1 product) and
      // apply via the shared generic writer, which also recomputes the aggregate quantity.
      if (hasOptionQuantities(link.storeItem.variants)) {
        const product = await fetchWixV1Product(ctx.accessToken, link.externalListingId, wixOpts);
        const axes = product ? wixV1ProductToVariants(product) : null;
        changed = await applyRemoteVariantAxesToStoreItem(link.storeItemId, axes);
      } else {
        const { quantity, known } = await adapter.fetchProductQuantity!(
          ctx,
          link.externalListingId
        );
        if (!known) continue;
        changed = await applyRemoteQuantityToStoreItem(link.storeItemId, quantity);
      }
      if (!changed) continue;
      await recordInventoryBaseline(link.id, link.storeItemId);
      await syncInventoryToChannels(link.storeItemId, { skipProviders: ["wix"] });
      updated += 1;
    } catch (e) {
      console.error("[channels] pullWixInventory failed", {
        storeItemId: link.storeItemId,
        externalListingId: link.externalListingId,
        error: String(e),
      });
    }
  }

  if (updated > 0) {
    console.info("[channels] pullWixInventory", { connectionId: connection.id, updated });
  }
  return { updated };
}
