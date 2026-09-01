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
}): Promise<{
  removed: number;
  checked: boolean;
  debug: {
    source: string;
    liveCount: number;
    linkedCount: number;
    missingCount: number;
    skippedInactive: number;
    skippedAlreadyPending: number;
    persistOk: number;
    persistFalse: number;
    liveSample: string[];
    missingSample: string[];
    listError: string | null;
  };
}> {
  const emptyDebug = {
    source: "none",
    liveCount: 0,
    linkedCount: 0,
    missingCount: 0,
    skippedInactive: 0,
    skippedAlreadyPending: 0,
    persistOk: 0,
    persistFalse: 0,
    liveSample: [] as string[],
    missingSample: [] as string[],
    listError: null as string | null,
  };
  if (connection.provider !== "wix") {
    return { removed: 0, checked: true, debug: { ...emptyDebug, source: "not_wix" } };
  }
  setWixConnectionContext(connection.id);
  const ctx = await getConnectionContext(connection);
  if (!ctx) {
    console.warn("[channels] Wix delete check skipped; no usable connection", {
      connectionId: connection.id,
      status: connection.status,
    });
    // #region agent log
    fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ad9cb6" },
      body: JSON.stringify({
        sessionId: "ad9cb6",
        hypothesisId: "A",
        location: "flag-remote-deleted.ts:no_ctx",
        message: "Wix delete check skipped; no connection context",
        data: { connectionId: connection.id, status: connection.status },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    return {
      removed: 0,
      checked: false,
      debug: { ...emptyDebug, source: "no_ctx" },
    };
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

  let source = "listRemoteListings";
  let listError: string | null = null;
  let liveIds: Set<string> | null = null;
  try {
    const listings = await getAdapter("wix").listRemoteListings(ctx);
    liveIds = new Set(
      listings.map((l) => l.externalListingId.trim()).filter(Boolean)
    );
  } catch (e) {
    listError = e instanceof Error ? e.message : String(e);
    console.warn("[channels] Wix listRemoteListings failed; falling back to live id list", {
      connectionId: connection.id,
      error: listError,
    });
  }

  if (!liveIds) {
    const live = await listLiveWixProductIds(ctx);
    source = "listLiveWixProductIds";
    if (!live) {
      source = "perProductGet";
      const removed = await flagGoneWixLinks(ctx, links);
      const debug = {
        ...emptyDebug,
        source,
        linkedCount: links.length,
        persistOk: removed,
        listError,
      };
      // #region agent log
      fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ad9cb6" },
        body: JSON.stringify({
          sessionId: "ad9cb6",
          hypothesisId: "B",
          location: "flag-remote-deleted.ts:perProductGet",
          message: "Fell back to per-product GET",
          data: debug,
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return { removed, checked: true, debug };
    }
    if (live.truncated) {
      source = "listLiveWixProductIds_truncated";
      const missingFallback = links.filter((link) =>
        wixLinkMissingFromLiveCatalog(link.externalListingId, new Set(live.ids))
      );
      const removed = await flagGoneWixLinks(ctx, missingFallback);
      const debug = {
        ...emptyDebug,
        source,
        liveCount: live.ids.length,
        linkedCount: links.length,
        missingCount: missingFallback.length,
        persistOk: removed,
        liveSample: live.ids.slice(0, 8),
        missingSample: missingFallback.map((l) => l.externalListingId).slice(0, 8),
        listError,
      };
      return { removed, checked: true, debug };
    }
    liveIds = new Set(live.ids);
  }

  const missing = links.filter((link) =>
    wixLinkMissingFromLiveCatalog(link.externalListingId, liveIds)
  );

  let skippedInactive = 0;
  let skippedAlreadyPending = 0;
  let persistOk = 0;
  let persistFalse = 0;
  let removed = 0;
  for (const link of missing) {
    if (link.storeItem.status === "sold_out" || link.storeItem.status === "inactive") {
      skippedInactive += 1;
      continue;
    }
    if (isRemoteDeletedPending(link.conflictDetails)) {
      skippedAlreadyPending += 1;
      continue;
    }
    const flagged = await persistRemoteDeletedPending({
      linkId: link.id,
      conflictDetails: link.conflictDetails,
      provider: "wix",
    });
    if (flagged) {
      persistOk += 1;
      console.warn("[channels] Wix product not in live catalog; waiting for seller decision", {
        linkId: link.id,
        externalListingId: link.externalListingId,
      });
      removed += 1;
    } else {
      persistFalse += 1;
    }
  }

  const debug = {
    source,
    liveCount: liveIds.size,
    linkedCount: links.length,
    missingCount: missing.length,
    skippedInactive,
    skippedAlreadyPending,
    persistOk,
    persistFalse,
    liveSample: [...liveIds].slice(0, 8),
    missingSample: missing.map((l) => l.externalListingId).slice(0, 8),
    listError,
  };
  // #region agent log
  fetch("http://127.0.0.1:7258/ingest/d5ed32a3-508e-4e39-8711-9dcd44c7de36", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ad9cb6" },
    body: JSON.stringify({
      sessionId: "ad9cb6",
      hypothesisId: "B",
      location: "flag-remote-deleted.ts:result",
      message: "Wix delete check result",
      data: debug,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  console.info("[channels] Wix live catalog vs linked listings", debug);
  return { removed, checked: true, debug };
}

export async function flagSellerWixDeletes(
  memberId: string
): Promise<{
  removed: number;
  checked: boolean;
  debug: Record<string, unknown> | null;
}> {
  const connections = await prisma.channelConnection.findMany({
    where: { memberId, provider: "wix", status: { not: "disconnected" } },
  });
  if (connections.length === 0) {
    return { removed: 0, checked: true, debug: { source: "no_wix_connection" } };
  }
  let removed = 0;
  let checked = true;
  let debug: Record<string, unknown> | null = null;
  for (const conn of connections) {
    const result = await flagGoneWixListingsForConnection(conn);
    removed += result.removed;
    if (!result.checked) checked = false;
    debug = result.debug;
  }
  return { removed, checked, debug };
}
