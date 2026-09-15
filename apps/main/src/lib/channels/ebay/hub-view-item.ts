/**
 * Copy Seller Hub listed remaining onto offer.availableQuantity (View Item).
 * Hub Revise does not write that field; INW must, but never during the Revise.
 */

import { prisma } from "database";
import { ebayGet } from "./client";
import { EBAY_MARKETPLACE_ID } from "./config";
import { resolveEbayLivePushSku } from "./inventory-sku";
import { pickEbayOffer } from "./publish-policy";
import { pushEbayOfferQuantitiesOnly, type EbayVariantQuantityRow } from "./quantity";
import {
  ebayInwPushedRecently,
  ebaySellerHubListedQuantity,
  fetchEbayItemDetails,
  type EbayItemDetails,
} from "./trading";
import { getConnectionContext } from "../connection";
import { matrixForStorage, variantsFingerprint } from "../variant-sync";

export const EBAY_HUB_VIEW_ITEM_COPY_DELAY_MS = 25_000;

export type EbayHubViewItemCopyDecision =
  | "copy"
  | "skip_inw_changed"
  | "skip_already_live"
  | "skip_echo"
  | "skip_no_hub";

export type EbayHubViewItemCopyResult = {
  copied: boolean;
  reason: EbayHubViewItemCopyDecision | "skip_no_offer" | "skip_no_sku" | "error";
  hubQty?: number;
  viewQty?: number;
};

export type EbayHubViewItemLink = {
  id: string;
  externalListingId: string;
  linkOrigin?: string | null;
  syncBaselineQty?: number | null;
  lastPushedAt?: Date | null;
};

export type EbayHubViewItemStore = {
  id: string;
  quantity: number;
  sku?: string | null;
  variants?: unknown;
  status?: string | null;
};

export function ebayHubViewItemCopyDecision(args: {
  hubQty: number | null;
  viewQty: number | null;
  inwQty: number;
  baselineQty: number | null | undefined;
  lastPushedAt: Date | null | undefined;
  now?: Date;
}): EbayHubViewItemCopyDecision {
  const hub =
    args.hubQty == null || !Number.isFinite(args.hubQty)
      ? null
      : Math.max(0, Math.round(args.hubQty));
  const view =
    args.viewQty == null || !Number.isFinite(args.viewQty)
      ? null
      : Math.max(0, Math.round(args.viewQty));
  if (hub == null) return "skip_no_hub";
  if (view != null && hub === view) return "skip_already_live";
  if (ebayInwPushedRecently(args.lastPushedAt, args.now)) return "skip_echo";
  if (args.baselineQty != null && args.inwQty !== args.baselineQty) return "skip_inw_changed";
  return "copy";
}

async function findPublishedOfferId(accessToken: string, sku: string): Promise<string | null> {
  try {
    const res = await ebayGet<{ offers?: Array<{ offerId?: string; status?: string }> }>(
      accessToken,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    return pickEbayOffer(res.offers)?.offerId?.trim() || null;
  } catch {
    return null;
  }
}

function hubVariantRows(details: EbayItemDetails): { sku: string; quantity: number }[] {
  const matrix = matrixForStorage(details.tradingVariants);
  if (!matrix?.skus.length) return [];
  const rows: { sku: string; quantity: number }[] = [];
  for (const row of matrix.skus) {
    const sku = row.sku?.trim();
    if (!sku) continue;
    rows.push({ sku, quantity: Math.max(0, Math.round(row.quantity)) });
  }
  return rows;
}

export async function publishEbayHubListedQuantityToViewItem(args: {
  accessToken: string;
  itemId: string;
  storeItem: EbayHubViewItemStore;
  link: EbayHubViewItemLink;
  details?: EbayItemDetails;
}): Promise<EbayHubViewItemCopyResult> {
  try {
    const details = args.details ?? (await fetchEbayItemDetails(args.accessToken, args.itemId));
    const hubQty = ebaySellerHubListedQuantity(details);
    const viewQty =
      details.quantity == null || !Number.isFinite(details.quantity)
        ? null
        : Math.max(0, Math.round(details.quantity));
    const reason = ebayHubViewItemCopyDecision({
      hubQty,
      viewQty,
      inwQty: args.storeItem.quantity,
      baselineQty: args.link.syncBaselineQty,
      lastPushedAt: args.link.lastPushedAt,
    });
    if (reason !== "copy" || hubQty == null) {
      return { copied: false, reason, hubQty: hubQty ?? undefined, viewQty: viewQty ?? undefined };
    }

    const liveSku = await resolveEbayLivePushSku(args.accessToken, {
      itemId: args.storeItem.id,
      itemSku: args.storeItem.sku,
      externalListingId: args.link.externalListingId,
      linkOrigin: args.link.linkOrigin,
      liveCustomLabel: details.sku,
    });
    if (!liveSku) {
      return { copied: false, reason: "skip_no_sku", hubQty, viewQty: viewQty ?? undefined };
    }

    const variantRows = hubVariantRows(details);
    const offerRows: EbayVariantQuantityRow[] = [];
    if (variantRows.length > 0) {
      for (const row of variantRows) {
        const offerId = await findPublishedOfferId(args.accessToken, row.sku);
        if (!offerId) continue;
        offerRows.push({ sku: row.sku, quantity: row.quantity, offerId });
      }
    } else {
      const offerId = await findPublishedOfferId(args.accessToken, liveSku);
      if (offerId) {
        offerRows.push({ sku: liveSku, quantity: hubQty, offerId });
      }
    }
    if (offerRows.length === 0) {
      console.warn("[ebay] hub View Item copy skipped; no live offer", {
        itemId: args.itemId,
        storeItemId: args.storeItem.id,
        liveSku,
      });
      return { copied: false, reason: "skip_no_offer", hubQty, viewQty: viewQty ?? undefined };
    }

    await pushEbayOfferQuantitiesOnly(args.accessToken, offerRows);
    const variantMatrix = variantRows.length > 0 ? matrixForStorage(details.tradingVariants) : null;
    await prisma.storeItem.update({
      where: { id: args.storeItem.id },
      data: {
        quantity: hubQty,
        status: hubQty > 0 ? "active" : "sold_out",
        ...(variantMatrix ? { variants: variantMatrix as object } : {}),
      },
    });
    await prisma.channelListingLink.update({
      where: { id: args.link.id },
      data: {
        syncBaselineQty: hubQty,
        lastInboundAt: new Date(),
        ...(variantMatrix
          ? { syncBaselineVariantsHash: variantsFingerprint(variantMatrix) }
          : {}),
      },
    });
    console.info("[ebay] copied Hub listed remaining onto View Item offer", {
      itemId: args.itemId,
      storeItemId: args.storeItem.id,
      hubQty,
      viewQty,
      skuCount: offerRows.length,
    });
    return { copied: true, reason: "copy", hubQty, viewQty: viewQty ?? undefined };
  } catch (e) {
    console.warn("[ebay] Hub listed remaining → View Item copy failed", {
      itemId: args.itemId,
      storeItemId: args.storeItem.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return { copied: false, reason: "error" };
  }
}

export async function publishEbayHubListedQuantityByItemId(itemId: string): Promise<EbayHubViewItemCopyResult> {
  const legacy = itemId.trim();
  if (!legacy) return { copied: false, reason: "skip_no_sku" };
  const link = await prisma.channelListingLink.findFirst({
    where: {
      provider: "ebay",
      OR: [{ externalListingId: legacy }, { externalListingId: `inw${legacy}` }],
      connection: { status: { not: "disconnected" } },
    },
    include: {
      connection: true,
      storeItem: {
        select: { id: true, quantity: true, sku: true, variants: true, status: true },
      },
    },
  });
  if (!link?.storeItem || !link.connection) {
    return { copied: false, reason: "skip_no_sku" };
  }
  const ctx = await getConnectionContext(link.connection);
  if (!ctx) return { copied: false, reason: "error" };
  return publishEbayHubListedQuantityToViewItem({
    accessToken: ctx.accessToken,
    itemId: legacy,
    storeItem: link.storeItem,
    link: {
      id: link.id,
      externalListingId: link.externalListingId,
      linkOrigin: link.linkOrigin,
      syncBaselineQty: link.syncBaselineQty,
      lastPushedAt: link.lastPushedAt,
    },
  });
}

/** Sleep happens inside waitUntil so the webhook can 200 before any eBay token use. */
export async function scheduleEbayHubViewItemCopy(itemId: string): Promise<EbayHubViewItemCopyResult> {
  await new Promise((r) => setTimeout(r, EBAY_HUB_VIEW_ITEM_COPY_DELAY_MS));
  return publishEbayHubListedQuantityByItemId(itemId);
}
