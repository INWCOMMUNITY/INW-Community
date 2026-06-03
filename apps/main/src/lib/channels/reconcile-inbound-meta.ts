import { prisma } from "database";
import { getConnectionContext } from "./connection";
import { applyRemoteListingRemoved } from "./apply-remote-listing";
import {
  applyRemoteCategoryToStoreItem,
  applyRemoteShippingToStoreItem,
  applyRemoteVariantsToStoreItem,
} from "./apply-remote-meta";
import { getAdapter } from "./registry";
import { updateStoreItemOnChannels } from "./outbound";
import { channelSyncSucceeded, syncInventoryToChannels } from "./sync-inventory";
import {
  resolveSyncDirection,
  syncContentHash,
  syncMetaHash,
  SYNC_ECHO_SKEW_MS,
  type SyncDirection,
} from "./sync-baseline";
import type { ChannelProvider, RemoteListingSummary } from "./types";
import type { InwVariantAxis } from "./variant-sync";
import { sumVariantQuantities } from "./variant-sync";
import { hasOptionQuantities, sumOptionQuantities } from "@/lib/store-item-variants";

function inwMissingVariants(variants: unknown): boolean {
  if (variants == null) return true;
  if (!Array.isArray(variants)) return true;
  return variants.length === 0;
}

function remoteVariantQtySum(remote: RemoteListingSummary): number {
  if (!remote.variants || !Array.isArray(remote.variants)) return 0;
  return (
    sumVariantQuantities(remote.variants as InwVariantAxis[]) ||
    sumOptionQuantities(remote.variants)
  );
}

function inwAllOptionQtyZero(variants: unknown): boolean {
  if (inwMissingVariants(variants)) return false;
  if (!hasOptionQuantities(variants)) return false;
  return sumOptionQuantities(variants) === 0;
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

type LinkRow = {
  id: string;
  storeItemId: string;
  externalListingId: string;
  syncBaselineHash: string | null;
  syncBaselineMetaHash: string | null;
  syncBaselineQty: number | null;
  syncBaselineAt: Date | null;
  storeItem: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
    quantity: number;
    category: string | null;
    subcategory: string | null;
    secondaryCategory: string | null;
    shippingCostCents: number | null;
    variants: unknown;
    updatedAt: Date;
  };
};

async function writeBaseline(
  linkId: string,
  storeItemId: string,
  remote: RemoteListingSummary | null,
  pushed: boolean
): Promise<void> {
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
  const baselineAt = pushed
    ? new Date(Date.now() + SYNC_ECHO_SKEW_MS)
    : remote?.remoteUpdatedAt ?? new Date();
  await prisma.channelListingLink
    .update({
      where: { id: linkId },
      data: {
        syncBaselineHash: syncContentHash(item),
        syncBaselineMetaHash: syncMetaHash(item),
        syncBaselineQty: item.quantity,
        syncBaselineAt: baselineAt,
      },
    })
    .catch((e) => console.error("[channels] write baseline failed", { linkId, error: String(e) }));
}

/** Two-way meta reconcile (category, shipping, variants) for all linked providers. */
export async function reconcileConnectionInboundMeta(
  connection: ConnectionRow
): Promise<{ updated: number; removed: number }> {
  const provider = connection.provider as ChannelProvider;
  const ctx = await getConnectionContext(connection);
  if (!ctx) return { updated: 0, removed: 0 };

  let remoteList: RemoteListingSummary[];
  try {
    remoteList = await getAdapter(provider).listRemoteListings(ctx);
  } catch (e) {
    console.error("[channels] inbound meta list failed", { provider, error: String(e) });
    return { updated: 0, removed: 0 };
  }

  if (remoteList.length === 0) return { updated: 0, removed: 0 };

  const remoteById = new Map(remoteList.map((r) => [r.externalListingId, r]));

  if (provider === "wix" && ctx) {
    const { attachWixVariantsToSummary, fetchWixV1Product } = await import("./wix/collections");
    const { wixSiteIdFromConn } = await import("./wix/site");
    const siteId = wixSiteIdFromConn(ctx);
    const wixOpts = siteId ? { siteId } : {};
    for (const r of remoteList) {
      if (!r.externalListingId) continue;
      const needsFull =
        !r.variantsKnown ||
        (r.variantsKnown && remoteVariantQtySum(r) === 0);
      if (!needsFull) continue;
      const full = await fetchWixV1Product(ctx.accessToken, r.externalListingId, wixOpts);
      if (full) attachWixVariantsToSummary(r, full);
    }
  }

  const links = (await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider, syncEnabled: true },
    select: {
      id: true,
      storeItemId: true,
      externalListingId: true,
      syncBaselineHash: true,
      syncBaselineMetaHash: true,
      syncBaselineQty: true,
      syncBaselineAt: true,
      storeItem: {
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
          updatedAt: true,
        },
      },
    },
  })) as LinkRow[];

  let updated = 0;
  let removed = 0;

  for (const link of links) {
    const remote = remoteById.get(link.externalListingId);
    if (!remote) {
      if (provider === "wix") {
        await applyRemoteListingRemoved(link.storeItemId);
        await syncInventoryToChannels(link.storeItemId, { skipProviders: ["wix"] });
        await prisma.channelListingLink.update({
          where: { id: link.id },
          data: { lastInboundAt: new Date() },
        });
        await writeBaseline(link.id, link.storeItemId, null, false);
        removed += 1;
      }
      continue;
    }

    const item = link.storeItem;

    // Backfill listings imported before Wix variant qty parsing was fixed.
    if (
      remote.variantsKnown &&
      remote.variants &&
      (inwMissingVariants(item.variants) ||
        (provider === "wix" &&
          inwAllOptionQtyZero(item.variants) &&
          remoteVariantQtySum(remote) > 0))
    ) {
      const vars = await applyRemoteVariantsToStoreItem(link.storeItemId, remote, provider);
      if (vars) {
        await prisma.channelListingLink.update({
          where: { id: link.id },
          data: { lastInboundAt: new Date() },
        });
        await writeBaseline(link.id, link.storeItemId, remote, false);
        updated += 1;
        continue;
      }
    }

    const inwMetaHash = syncMetaHash(item);
    const baseMetaHash = link.syncBaselineMetaHash ?? inwMetaHash;
    const baseAt = link.syncBaselineAt ?? remote.remoteUpdatedAt ?? new Date();
    const inwMetaChanged = inwMetaHash !== baseMetaHash;
    const remoteMetaChanged =
      remote.remoteUpdatedAt != null && remote.remoteUpdatedAt.getTime() > baseAt.getTime();
    const metaDecision: SyncDirection = resolveSyncDirection({
      inwChanged: inwMetaChanged,
      remoteChanged: remoteMetaChanged,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    });

    if (metaDecision === "noop") {
      if (link.syncBaselineMetaHash == null) {
        await writeBaseline(link.id, link.storeItemId, remote, false);
      }
      continue;
    }

    let pulled = false;
    if (metaDecision === "pull") {
      const cat = await applyRemoteCategoryToStoreItem(link.storeItemId, remote, provider);
      const ship = await applyRemoteShippingToStoreItem(link.storeItemId, remote);
      const vars = await applyRemoteVariantsToStoreItem(link.storeItemId, remote, provider);
      pulled = cat || ship || vars;
    }

    let attemptedPush = false;
    let pushOk = false;
    if (metaDecision === "push") {
      attemptedPush = true;
      pushOk = channelSyncSucceeded(await updateStoreItemOnChannels(link.storeItemId), provider);
    }

    if (pulled && metaDecision !== "push") {
      await updateStoreItemOnChannels(link.storeItemId, { skipProviders: [provider] });
    }

    if (pulled) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
    }
    if (attemptedPush && pushOk) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastPushedAt: new Date() },
      });
    }

    if (pulled || (attemptedPush && pushOk)) {
      await writeBaseline(link.id, link.storeItemId, remote, attemptedPush && pushOk);
    } else if (link.syncBaselineMetaHash == null) {
      await writeBaseline(link.id, link.storeItemId, remote, false);
    }
    updated += 1;
  }

  if (updated > 0 || removed > 0) {
    console.info("[channels] inbound meta sync", {
      provider,
      connectionId: connection.id,
      updated,
      removed,
    });
  }
  return { updated, removed };
}
