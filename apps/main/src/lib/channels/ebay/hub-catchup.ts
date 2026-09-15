import { waitUntil } from "@vercel/functions";
import { prisma } from "database";
import { getConnectionContext } from "../connection";
import { resolveEbayLegacyListingId } from "./mapping";
import { refreshEbayListingByItemId } from "./pull-ebay-updates";
import { EBAY_HUB_CATCHUP_DELAY_MS, EBAY_HUB_CATCHUP_RETRY_TYPE } from "./qty-price-surfaces";

export { EBAY_HUB_CATCHUP_DELAY_MS, EBAY_HUB_CATCHUP_RETRY_TYPE };

export async function hasPendingEbayHubCatchup(linkId: string): Promise<boolean> {
  const row = await prisma.channelSyncRetry.findFirst({
    where: { linkId, retryType: EBAY_HUB_CATCHUP_RETRY_TYPE },
    select: { id: true },
  });
  return Boolean(row);
}

export async function enqueueEbayHubCatchup(args: {
  linkId: string;
  storeItemId: string;
  delayMs?: number;
}): Promise<void> {
  const delay = args.delayMs ?? EBAY_HUB_CATCHUP_DELAY_MS;
  const nextRetryAt = new Date(Date.now() + delay);
  const existing = await prisma.channelSyncRetry.findFirst({
    where: { linkId: args.linkId, retryType: EBAY_HUB_CATCHUP_RETRY_TYPE },
  });
  if (existing) {
    await prisma.channelSyncRetry.update({
      where: { id: existing.id },
      data: {
        nextRetryAt: existing.nextRetryAt < nextRetryAt ? existing.nextRetryAt : nextRetryAt,
        lastError: "ItemRevised Hub→View Item catch-up",
      },
    });
    return;
  }
  await prisma.channelSyncRetry.create({
    data: {
      linkId: args.linkId,
      storeItemId: args.storeItemId,
      provider: "ebay",
      retryType: EBAY_HUB_CATCHUP_RETRY_TYPE,
      attempts: 0,
      maxAttempts: 5,
      nextRetryAt,
      lastError: "ItemRevised Hub→View Item catch-up",
    },
  });
}

export async function findEbayLinkForRevise(args: {
  itemId: string | null;
  ebayUserId: string | null;
}): Promise<{ linkId: string; storeItemId: string; connectionId: string } | null> {
  if (args.itemId) {
    const link = await prisma.channelListingLink.findFirst({
      where: {
        provider: "ebay",
        OR: [{ externalListingId: args.itemId }, { externalListingId: `inw${args.itemId}` }],
        connection: { status: { not: "disconnected" } },
      },
      select: { id: true, storeItemId: true, connectionId: true },
    });
    if (link) return { linkId: link.id, storeItemId: link.storeItemId, connectionId: link.connectionId };
  }
  if (!args.ebayUserId || !args.itemId) return null;
  const connection = await prisma.channelConnection.findFirst({
    where: {
      provider: "ebay",
      externalShopId: args.ebayUserId,
      status: { not: "disconnected" },
    },
    select: { id: true },
  });
  if (!connection) return null;
  const link = await prisma.channelListingLink.findFirst({
    where: {
      connectionId: connection.id,
      provider: "ebay",
      OR: [{ externalListingId: args.itemId }, { externalListingId: `inw${args.itemId}` }],
    },
    select: { id: true, storeItemId: true, connectionId: true },
  });
  return link
    ? { linkId: link.id, storeItemId: link.storeItemId, connectionId: link.connectionId }
    : null;
}

export async function runEbayHubCatchupForStoreItem(storeItemId: string): Promise<void> {
  const link = await prisma.channelListingLink.findFirst({
    where: { storeItemId, provider: "ebay", syncEnabled: true },
    include: { connection: true },
  });
  if (!link?.connection || link.connection.status === "disconnected") return;
  const ctx = await getConnectionContext(link.connection);
  if (!ctx) return;
  const listingId = resolveEbayLegacyListingId(link.externalListingId) ?? link.externalListingId;
  await refreshEbayListingByItemId(ctx.accessToken, listingId, { source: "webhook" });
}

export async function runEbayHubCatchupFromRevise(args: {
  itemId: string | null;
  ebayUserId: string | null;
}): Promise<void> {
  const found = await findEbayLinkForRevise(args);
  if (!found) {
    console.info("[ebay] Hub catch-up: no link for ItemRevised", {
      itemId: args.itemId,
      ebayUserId: args.ebayUserId,
    });
    return;
  }
  await enqueueEbayHubCatchup({ linkId: found.linkId, storeItemId: found.storeItemId, delayMs: 0 });
  await runEbayHubCatchupForStoreItem(found.storeItemId);
  await prisma.channelSyncRetry
    .deleteMany({
      where: { linkId: found.linkId, retryType: EBAY_HUB_CATCHUP_RETRY_TYPE },
    })
    .catch(() => {});
}

/** Durable retry row first — do not depend on waitUntil surviving the request. */
export async function enqueueEbayHubCatchupFromRevise(args: {
  itemId: string | null;
  ebayUserId: string | null;
}): Promise<void> {
  const found = await findEbayLinkForRevise(args);
  if (!found) return;
  await enqueueEbayHubCatchup({
    linkId: found.linkId,
    storeItemId: found.storeItemId,
  });
}

/** Ack ItemRevised immediately; copy Hub→warehouse+offer after a short settle delay. */
export function scheduleEbayHubCatchupFromRevise(args: {
  itemId: string | null;
  ebayUserId: string | null;
}): void {
  if (!args.itemId && !args.ebayUserId) return;
  const work = (async () => {
    await new Promise((resolve) => setTimeout(resolve, EBAY_HUB_CATCHUP_DELAY_MS));
    await runEbayHubCatchupFromRevise(args);
  })().catch((e) => {
    console.warn("[ebay] delayed Hub→View Item catch-up failed", {
      itemId: args.itemId,
      error: e instanceof Error ? e.message : String(e),
    });
  });
  waitUntil(work);
}
