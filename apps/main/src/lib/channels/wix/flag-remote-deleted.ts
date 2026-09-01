import { prisma } from "database";
import { getConnectionContext } from "../connection";
import {
  isRemoteDeletedPending,
  persistRemoteDeletedPending,
} from "../listing-link-flags";
import type { ChannelConnectionContext } from "../types";
import { setWixConnectionContext } from "./client";
import { listLiveWixProductIds, wixLinkMissingFromLiveCatalog } from "./list-live-ids";
import { wixProductIsGone } from "./listing-exists";
import { ensureWixSiteId } from "./site";

type WixLinkToCheck = {
  id: string;
  externalListingId: string;
  conflictDetails: unknown;
  storeItem: { status: string };
};

export async function flagGoneWixLinks(
  ctx: ChannelConnectionContext,
  links: WixLinkToCheck[]
): Promise<number> {
  let removed = 0;
  for (const link of links) {
    if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") continue;
    if (isRemoteDeletedPending(link.conflictDetails)) continue;
    const gone = await wixProductIsGone(ctx, link.externalListingId);
    if (!gone) continue;
    const flagged = await persistRemoteDeletedPending({
      linkId: link.id,
      conflictDetails: link.conflictDetails,
      provider: "wix",
    });
    if (flagged) {
      console.warn("[channels] Wix product gone; waiting for seller decision", {
        linkId: link.id,
        externalListingId: link.externalListingId,
      });
      removed += 1;
    }
  }
  return removed;
}

/** Lightweight My Items / webhook path: probe linked Wix products without listing the whole catalog. */
export async function flagGoneWixListingsForConnection(connection: {
  id: string;
  memberId: string;
  provider: string;
  status: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: Date | null;
  externalShopId: string | null;
  etsyShippingProfileId: string | null;
  config?: unknown;
}): Promise<{ removed: number }> {
  if (connection.provider !== "wix") return { removed: 0 };
  setWixConnectionContext(connection.id);
  const ctx = await getConnectionContext(connection);
  if (!ctx) return { removed: 0 };
  await ensureWixSiteId(ctx).catch(() => null);

  const links = await prisma.channelListingLink.findMany({
    where: { connectionId: connection.id, provider: "wix", syncEnabled: true },
    select: {
      id: true,
      externalListingId: true,
      conflictDetails: true,
      storeItem: { select: { status: true } },
    },
  });

  const live = await listLiveWixProductIds(ctx);
  if (!live) {
    const removed = await flagGoneWixLinks(ctx, links);
    return { removed };
  }

  const liveIds = new Set(live.ids);
  const missing = links.filter((link) =>
    wixLinkMissingFromLiveCatalog(link.externalListingId, liveIds)
  );

  // A truncated catalog must not mark later pages as deleted.
  if (live.truncated) {
    const removed = await flagGoneWixLinks(ctx, missing);
    return { removed };
  }

  let removed = 0;
  for (const link of missing) {
    if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") continue;
    if (isRemoteDeletedPending(link.conflictDetails)) continue;
    const flagged = await persistRemoteDeletedPending({
      linkId: link.id,
      conflictDetails: link.conflictDetails,
      provider: "wix",
    });
    if (flagged) {
      console.warn("[channels] Wix product not in live catalog; waiting for seller decision", {
        linkId: link.id,
        externalListingId: link.externalListingId,
      });
      removed += 1;
    }
  }
  return { removed };
}

export async function flagSellerWixDeletes(memberId: string): Promise<number> {
  const connections = await prisma.channelConnection.findMany({
    where: { memberId, provider: "wix", status: { not: "disconnected" } },
  });
  let removed = 0;
  for (const conn of connections) {
    removed += (await flagGoneWixListingsForConnection(conn)).removed;
  }
  return removed;
}
