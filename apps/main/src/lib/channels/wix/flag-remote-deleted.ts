import { prisma } from "database";
import { getConnectionContext } from "../connection";
import { getAdapter } from "../registry";
import {
  isRemoteDeletedPending,
  persistRemoteDeletedPending,
} from "../listing-link-flags";
import type { ChannelConnectionContext } from "../types";
import { setWixConnectionContext } from "./client";
import { listLiveWixProductIds, wixLinkMissingFromLiveCatalog } from "./list-live-ids";
import { wixProductIsGone } from "./listing-exists";
import { ensureWixSiteId, remintWixAccessToken } from "./site";

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
}): Promise<{ removed: number; checked: boolean }> {
  if (connection.provider !== "wix") return { removed: 0, checked: true };
  setWixConnectionContext(connection.id);
  const ctx = await getConnectionContext(connection);
  if (!ctx) {
    console.warn("[channels] Wix delete check skipped; no usable connection", {
      connectionId: connection.id,
      status: connection.status,
    });
    return { removed: 0, checked: false };
  }
  // Fresh 4h app token so a stale JWT does not silently skip the catalog check.
  await remintWixAccessToken(ctx);
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

  // Same catalog call as /api/channels/wix/health. That endpoint already
  // returns 0 products for this shop while listLiveWixProductIds still
  // finds deleted IDs on a fallback API.
  let liveIds: Set<string> | null = null;
  try {
    const listings = await getAdapter("wix").listRemoteListings(ctx);
    liveIds = new Set(
      listings.map((l) => l.externalListingId.trim()).filter(Boolean)
    );
  } catch (e) {
    console.warn("[channels] Wix listRemoteListings failed; falling back to live id list", {
      connectionId: connection.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (!liveIds) {
    const live = await listLiveWixProductIds(ctx);
    if (!live) {
      const removed = await flagGoneWixLinks(ctx, links);
      return { removed, checked: true };
    }
    if (live.truncated) {
      const missingFallback = links.filter((link) =>
        wixLinkMissingFromLiveCatalog(link.externalListingId, new Set(live.ids))
      );
      const removed = await flagGoneWixLinks(ctx, missingFallback);
      return { removed, checked: true };
    }
    liveIds = new Set(live.ids);
  }

  const missing = links.filter((link) =>
    wixLinkMissingFromLiveCatalog(link.externalListingId, liveIds)
  );
  console.info("[channels] Wix live catalog vs linked listings", {
    connectionId: connection.id,
    liveCount: liveIds.size,
    linkedCount: links.length,
    missingCount: missing.length,
  });

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
  return { removed, checked: true };
}

export async function flagSellerWixDeletes(
  memberId: string
): Promise<{ removed: number; checked: boolean }> {
  const connections = await prisma.channelConnection.findMany({
    where: { memberId, provider: "wix", status: { not: "disconnected" } },
  });
  if (connections.length === 0) return { removed: 0, checked: true };
  let removed = 0;
  let checked = true;
  for (const conn of connections) {
    const result = await flagGoneWixListingsForConnection(conn);
    removed += result.removed;
    if (!result.checked) checked = false;
  }
  return { removed, checked };
}
