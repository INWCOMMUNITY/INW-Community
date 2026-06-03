import { prisma } from "database";
import { getConnectionContext } from "./connection";
import {
  applyRemoteContentToStoreItem,
  applyRemoteListingRemoved,
  applyRemoteQuantityToStoreItem,
} from "./apply-remote-listing";
import { getAdapter } from "./registry";
import { updateStoreItemOnChannels } from "./outbound";
import { syncInventoryToChannels } from "./sync-inventory";
import {
  resolveSyncDirection,
  syncContentHash,
  SYNC_ECHO_SKEW_MS,
  type SyncDirection,
} from "./sync-baseline";
import type { ChannelProvider, RemoteListingSummary } from "./types";

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
  syncBaselineQty: number | null;
  syncBaselineAt: Date | null;
  storeItem: {
    title: string;
    description: string | null;
    photos: string[];
    priceCents: number;
    quantity: number;
    updatedAt: Date;
  };
};

/** Recompute and persist the agreed baseline from the StoreItem's current state. */
async function writeBaseline(
  linkId: string,
  storeItemId: string,
  remote: RemoteListingSummary | null,
  pushed: boolean
): Promise<void> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { title: true, description: true, photos: true, priceCents: true, quantity: true },
  });
  if (!item) return;
  const hash = syncContentHash(item);
  // After a push, Wix's updatedDate jumps to ~now; skew the baseline forward so the next pass treats
  // that as our own echo. After a pull/no-op, anchor to the remote edit time we just reconciled to.
  const baselineAt = pushed
    ? new Date(Date.now() + SYNC_ECHO_SKEW_MS)
    : remote?.remoteUpdatedAt ?? new Date();
  await prisma.channelListingLink
    .update({
      where: { id: linkId },
      data: {
        syncBaselineHash: hash,
        syncBaselineQty: item.quantity,
        syncBaselineAt: baselineAt,
      },
    })
    .catch((e) => console.error("[channels] write baseline failed", { linkId, error: String(e) }));
}

/**
 * Two-way catalog reconcile for Wix linked products. Uses a stored per-link baseline (content hash +
 * quantity + timestamp) to detect which side changed since the last sync and pushes/pulls
 * accordingly; when both sides changed, the most recently edited side wins. Missing/hidden Wix
 * products mark the INW listing sold out.
 */
export async function reconcileConnectionInboundCatalog(
  connection: ConnectionRow
): Promise<{ updated: number; removed: number }> {
  const provider = connection.provider as ChannelProvider;
  if (provider !== "wix") return { updated: 0, removed: 0 };

  const ctx = await getConnectionContext(connection);
  if (!ctx) return { updated: 0, removed: 0 };

  let remoteList: RemoteListingSummary[];
  try {
    remoteList = await getAdapter(provider).listRemoteListings(ctx);
  } catch (e) {
    console.error("[channels] inbound catalog list failed", { provider, error: String(e) });
    return { updated: 0, removed: 0 };
  }

  // Empty catalog usually means wrong API version or a transient failure — do not mark all links removed.
  if (remoteList.length === 0) {
    console.warn("[channels] inbound catalog empty — skipping removal detection", {
      connectionId: connection.id,
    });
    return { updated: 0, removed: 0 };
  }

  const remoteById = new Map(remoteList.map((r) => [r.externalListingId, r]));

  const links = (await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider, syncEnabled: true },
    select: {
      id: true,
      storeItemId: true,
      externalListingId: true,
      syncBaselineHash: true,
      syncBaselineQty: true,
      syncBaselineAt: true,
      storeItem: {
        select: {
          title: true,
          description: true,
          photos: true,
          priceCents: true,
          quantity: true,
          updatedAt: true,
        },
      },
    },
  })) as LinkRow[];

  let updated = 0;
  let removed = 0;

  for (const link of links) {
    const remote = remoteById.get(link.externalListingId);

    // Product no longer visible on Wix (deleted or hidden) -> sell out on INW + push 0 to others.
    if (!remote) {
      await applyRemoteListingRemoved(link.storeItemId);
      await syncInventoryToChannels(link.storeItemId, { skipProviders: ["wix"] });
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
      await writeBaseline(link.id, link.storeItemId, null, false);
      removed += 1;
      continue;
    }

    const item = link.storeItem;
    const remoteQtyKnown = remote.quantityKnown !== false;

    // Baseline = last agreed state. Default to the current INW state so legacy/new links don't
    // trigger a destructive pull on first encounter; real divergences heal on the next pass.
    const inwHash = syncContentHash(item);
    const baseHash = link.syncBaselineHash ?? inwHash;
    const baseQty = link.syncBaselineQty ?? item.quantity;
    const baseAt = link.syncBaselineAt ?? remote.remoteUpdatedAt ?? new Date();

    const inwContentChanged = inwHash !== baseHash;
    const inwQtyChanged = item.quantity !== baseQty;
    const wixQtyChanged = remoteQtyKnown && remote.quantity !== baseQty;
    const wixContentChanged =
      remote.remoteUpdatedAt != null && remote.remoteUpdatedAt.getTime() > baseAt.getTime();

    const contentDecision: SyncDirection = resolveSyncDirection({
      inwChanged: inwContentChanged,
      remoteChanged: wixContentChanged,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    });
    const qtyDecision: SyncDirection = resolveSyncDirection({
      inwChanged: inwQtyChanged,
      remoteChanged: wixQtyChanged,
      inwUpdatedAt: item.updatedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt ?? null,
    });

    if (contentDecision === "noop" && qtyDecision === "noop") {
      // Initialize baseline for links that have never been reconciled with the new scheme.
      if (link.syncBaselineHash == null || link.syncBaselineAt == null) {
        await writeBaseline(link.id, link.storeItemId, remote, false);
      }
      continue;
    }

    // 1) Apply Wix -> INW pulls first so a later push carries the merged state.
    let pulledContent = false;
    let pulledQty = false;
    if (qtyDecision === "pull" && remoteQtyKnown) {
      pulledQty = await applyRemoteQuantityToStoreItem(link.storeItemId, remote.quantity);
    }
    if (contentDecision === "pull") {
      pulledContent = await applyRemoteContentToStoreItem(link.storeItemId, remote);
    }

    // 2) Push INW -> Wix (and all channels) when INW is the winner.
    const pushedToWix = contentDecision === "push" || qtyDecision === "push";
    if (contentDecision === "push") {
      // updateListing pushes content AND inventory, so this also covers a concurrent qty push.
      await updateStoreItemOnChannels(link.storeItemId);
    } else if (qtyDecision === "push") {
      await syncInventoryToChannels(link.storeItemId);
    }

    // 3) Propagate pulled changes to the OTHER channels (Wix already has them).
    if (pulledContent && contentDecision !== "push") {
      await updateStoreItemOnChannels(link.storeItemId, { skipProviders: ["wix"] });
    }
    if (pulledQty && !pushedToWix) {
      await syncInventoryToChannels(link.storeItemId, { skipProviders: ["wix"] });
    }

    if (pulledContent || pulledQty) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastInboundAt: new Date() },
      });
    }
    if (pushedToWix) {
      await prisma.channelListingLink.update({
        where: { id: link.id },
        data: { lastPushedAt: new Date() },
      });
    }

    await writeBaseline(link.id, link.storeItemId, remote, pushedToWix);
    updated += 1;
  }

  if (updated > 0 || removed > 0) {
    console.info("[channels] inbound catalog sync", {
      provider,
      connectionId: connection.id,
      updated,
      removed,
    });
  }
  return { updated, removed };
}
