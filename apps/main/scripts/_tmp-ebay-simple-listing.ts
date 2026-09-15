/**
 * Read-only dump for a simple (non-variant) eBay listing by ItemID.
 */
import { prisma } from "database";
import { getConnectionContext } from "../src/lib/channels/connection";
import { ebayGet } from "../src/lib/channels/ebay/client";
import { EBAY_MARKETPLACE_ID } from "../src/lib/channels/ebay/config";
import {
  fetchLiveInventoryItem,
  readLiveInventoryAvailableQuantity,
} from "../src/lib/channels/ebay/passthrough-push";
import { pickEbayOffer } from "../src/lib/channels/ebay/publish-policy";
import { fetchEbayItemDetails } from "../src/lib/channels/ebay/trading";

const LISTING_ID = process.argv[2] || "404516850572";

function asQty(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

async function main() {
  const link = await prisma.channelListingLink.findFirst({
    where: {
      provider: "ebay",
      OR: [
        { externalListingId: LISTING_ID },
        { externalListingId: `inw${LISTING_ID}` },
      ],
    },
    include: {
      storeItem: {
        select: {
          id: true,
          memberId: true,
          title: true,
          quantity: true,
          priceCents: true,
          updatedAt: true,
          variants: true,
          status: true,
        },
      },
      connection: true,
    },
  });
  if (!link?.storeItem) {
    console.log(JSON.stringify({ error: "no ebay link", listingId: LISTING_ID }));
    await prisma.$disconnect();
    return;
  }

  const item = link.storeItem;
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const logs = await prisma.channelSyncLog.findMany({
    where: { storeItemId: item.id, provider: "ebay", createdAt: { gt: since } },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { action: true, detail: true, createdAt: true },
  });
  const webhooks = await prisma.channelWebhookEvent.findMany({
    where: {
      provider: "ebay",
      createdAt: { gt: since },
      OR: [{ externalEventId: LISTING_ID }, { externalEventId: `inw${LISTING_ID}` }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { eventType: true, status: true, error: true, createdAt: true, processedAt: true, payload: true },
  });
  const ebayLinkCount = await prisma.channelListingLink.count({
    where: { connectionId: link.connectionId, provider: "ebay", syncEnabled: true },
  });
  const cfg = (link.connection.config ?? {}) as Record<string, unknown>;
  const dbDump = {
    listingId: LISTING_ID,
    externalListingId: link.externalListingId,
    storeItemId: item.id,
    inwTitle: item.title,
    inwQty: item.quantity,
    inwPriceCents: item.priceCents,
    variants: item.variants,
    updatedAt: item.updatedAt,
    lastPushedAt: link.lastPushedAt,
    lastInboundAt: link.lastInboundAt,
    syncBaselineQty: link.syncBaselineQty,
    syncStatus: link.syncStatus,
    syncError: link.syncError,
    syncEnabled: link.syncEnabled,
    conflictDetails: link.conflictDetails,
    connStatus: link.connection.status,
    lastReconciledAt: link.connection.lastReconciledAt,
    syncDirection: cfg.syncDirection ?? null,
    ebayLinkCount,
    logs,
    webhookCount: webhooks.length,
    webhooks: webhooks.map((w) => ({
      eventType: w.eventType,
      status: w.status,
      error: w.error,
      createdAt: w.createdAt,
      processedAt: w.processedAt,
      payload: w.payload,
    })),
  };

  const ctx = await getConnectionContext(link.connection as never);
  if (!ctx) {
    console.log(JSON.stringify({ ...dbDump, error: "no connection context (decrypt/token)" }, null, 2));
    await prisma.$disconnect();
    return;
  }

  const listingId = link.externalListingId.replace(/^inw/, "");
  const details = await fetchEbayItemDetails(ctx.accessToken, listingId);

  const skuCandidates = [
    (details as { sku?: string | null }).sku?.trim(),
    link.externalListingId.trim(),
    `inw${listingId}`,
    listingId,
  ].filter((s, i, arr): s is string => Boolean(s) && arr.indexOf(s) === i);

  let chosenSku = skuCandidates[0] ?? listingId;
  let inventoryQty: number | null = null;
  let offerSearchQty: number | null = null;
  let offerDetailQty: number | null = null;
  let offerStatus: string | null = null;
  let offerPrice: string | null = null;
  const skuHits: Array<Record<string, unknown>> = [];
  for (const sku of skuCandidates) {
    let inv: number | null = null;
    try {
      const live = await fetchLiveInventoryItem(ctx.accessToken, sku);
      inv = readLiveInventoryAvailableQuantity(live);
    } catch {
      inv = null;
    }
    let searchQty: number | null = null;
    let detailQty: number | null = null;
    let status: string | null = null;
    let price: string | null = null;
    let offerId: string | null = null;
    try {
      const search = await ebayGet<{
        offers?: Array<{
          offerId?: string;
          status?: string;
          availableQuantity?: unknown;
          pricingSummary?: { price?: { value?: string } };
        }>;
      }>(
        ctx.accessToken,
        `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
      );
      const offer = pickEbayOffer(search.offers);
      searchQty = asQty(offer?.availableQuantity);
      status = offer?.status ?? null;
      price = offer?.pricingSummary?.price?.value ?? null;
      offerId = offer?.offerId ?? null;
      if (offer?.offerId) {
        const detailsOffer = await ebayGet<{
          availableQuantity?: unknown;
          status?: string;
          pricingSummary?: { price?: { value?: string } };
        }>(ctx.accessToken, `/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}`);
        detailQty = asQty(detailsOffer.availableQuantity);
        price = detailsOffer.pricingSummary?.price?.value ?? price;
        status = detailsOffer.status ?? status;
      }
    } catch {
      // not an inventory offer for this sku
    }
    skuHits.push({ sku, inventoryQty: inv, offerSearchQty: searchQty, offerDetailQty: detailQty, offerStatus: status, offerPrice: price, offerId });
    if (inv != null || searchQty != null || detailQty != null || offerId) {
      chosenSku = sku;
      inventoryQty = inv;
      offerSearchQty = searchQty;
      offerDetailQty = detailQty;
      offerStatus = status;
      offerPrice = price;
    }
  }

  console.log(
    JSON.stringify(
      {
        ...dbDump,
        listingId,
        inwTitle: item.title,
        ebayTitle: details.title,
        inwQty: item.quantity,
        getItemQty: details.quantity,
        getItemQuantitySold: details.quantitySold,
        inventoryQty,
        offerSearchQty,
        offerDetailQty,
        offerStatus,
        inwPriceCents: item.priceCents,
        getItemPriceCents: details.priceCents,
        offerPrice,
        sku: chosenSku,
        skuHits,
        variants: item.variants,
        updatedAt: item.updatedAt,
        lastPushedAt: link.lastPushedAt,
        lastInboundAt: link.lastInboundAt,
        syncBaselineQty: link.syncBaselineQty,
        syncStatus: link.syncStatus,
        syncError: link.syncError,
        syncEnabled: link.syncEnabled,
        connStatus: link.connection.status,
        lastReconciledAt: link.connection.lastReconciledAt,
        syncDirection: cfg.syncDirection ?? null,
        ebayLastModified: details.remoteUpdatedAt,
        logs,
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
