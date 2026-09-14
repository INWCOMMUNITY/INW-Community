/**
 * GET-only live SKU snapshots for the read-only SKU audit.
 * Never calls updateListing, setEbayListingSku, or inventory PUT.
 */

import type { ChannelConnectionContext, ChannelProvider, RemoteListingSummary, SyncStoreItem } from "./types";
import { fetchEbayItemDetails } from "./ebay/trading";
import { resolveEbayLegacyListingId, resolveSyncLegacyListingId } from "./ebay/mapping";
import { resolveEbayPushSku } from "./ebay/listing-origin";
import { buildVariantInventoryRows } from "./ebay/inventory-groups";
import { enrichEtsyListingSummaryWithInventory } from "./etsy/variants";
import { setEtsyConnectionContext } from "./etsy/client";
import { fetchShopifyListingForInbound } from "./shopify/adapter";
import { fetchWixV1Product } from "./wix/collections";
import { setWixConnectionContext, wixGet } from "./wix/client";
import { wixInventoryRequestOpts } from "./wix/site";
import { wixV3ProductToVariants, type WixProduct } from "./wix/mapping";
import { variantsToMatrix } from "./variant-sync";
import {
  remoteRowsFromMatrix,
  wixV1VariantSkuRows,
  type RemoteSkuRow,
} from "./sku-audit";

export type HydratedChannelSkus = {
  provider: ChannelProvider;
  rows: RemoteSkuRow[];
  expectedEbayPushSkus?: string[];
  error?: string;
};

export function expectedEbayPushSkus(
  item: SyncStoreItem,
  link: { externalListingId: string; linkOrigin?: string | null }
): string[] {
  try {
    const rows = buildVariantInventoryRows(item, {
      parentSku: item.sku,
      imported: link.linkOrigin === "import",
      legacyListingId: resolveEbayLegacyListingId(link.externalListingId),
    });
    if (rows.length > 0) return rows.map((r) => r.sku);
  } catch {
    /* combo rows missing — fall through to parent push SKU */
  }
  return [
    resolveEbayPushSku({
      itemId: item.id,
      itemSku: item.sku,
      externalListingId: link.externalListingId,
      linkOrigin: link.linkOrigin,
    }),
  ];
}

async function hydrateEbay(
  ctx: ChannelConnectionContext,
  item: SyncStoreItem,
  link: { externalListingId: string; linkOrigin?: string | null }
): Promise<HydratedChannelSkus> {
  const expected = expectedEbayPushSkus(item, link);
  let legacy =
    resolveEbayLegacyListingId(link.externalListingId) ??
    resolveEbayLegacyListingId(item.sku ?? "") ??
    null;
  if (!legacy) {
    legacy = await resolveSyncLegacyListingId(ctx.accessToken, {
      linkedSku: link.externalListingId,
      sku: expected[0] ?? item.id,
      itemSku: item.sku,
    });
  }
  if (!legacy) {
    return {
      provider: "ebay",
      rows: [],
      expectedEbayPushSkus: expected,
      error: "No eBay Item ID on this link (cannot GetItem).",
    };
  }
  const details = await fetchEbayItemDetails(ctx.accessToken, legacy);
  const matrix = variantsToMatrix(details.variants);
  const rows = remoteRowsFromMatrix(matrix, details.sku);
  return { provider: "ebay", rows, expectedEbayPushSkus: expected };
}

async function hydrateEtsy(
  ctx: ChannelConnectionContext,
  externalListingId: string
): Promise<HydratedChannelSkus> {
  setEtsyConnectionContext(ctx.id);
  const summary: RemoteListingSummary = {
    externalListingId,
    title: "",
    description: null,
    priceCents: 0,
    quantity: 0,
    photos: [],
  };
  await enrichEtsyListingSummaryWithInventory(ctx.accessToken, summary, null);
  const matrix = variantsToMatrix(summary.variants);
  const rows = remoteRowsFromMatrix(matrix, summary.sku ?? null);
  return { provider: "etsy", rows };
}

async function hydrateShopify(
  ctx: ChannelConnectionContext,
  externalListingId: string
): Promise<HydratedChannelSkus> {
  const fetched = await fetchShopifyListingForInbound(ctx, externalListingId);
  if (fetched.status !== "ok") {
    return { provider: "shopify", rows: [], error: "Shopify product GET failed." };
  }
  const matrix = variantsToMatrix(fetched.summary.variants);
  const rows = remoteRowsFromMatrix(matrix, fetched.summary.sku ?? null);
  return { provider: "shopify", rows };
}

async function hydrateWix(
  ctx: ChannelConnectionContext,
  productId: string
): Promise<HydratedChannelSkus> {
  setWixConnectionContext(ctx.id);
  const attempts = wixInventoryRequestOpts(ctx);
  let v1Rows: RemoteSkuRow[] = [];
  for (const opts of attempts) {
    const product = await fetchWixV1Product(ctx.accessToken, productId, opts);
    if (product) {
      v1Rows = wixV1VariantSkuRows(product);
      if (v1Rows.some((r) => r.sku)) return { provider: "wix", rows: v1Rows };
      break;
    }
  }

  for (const opts of attempts) {
    try {
      const res = await wixGet<{ product?: WixProduct }>(
        ctx.accessToken,
        `/stores/v3/products/${encodeURIComponent(productId)}?fields=MEDIA_ITEMS_INFO&fields=PLAIN_DESCRIPTION`,
        opts
      );
      const product = res.product;
      if (!product) continue;
      const matrix = wixV3ProductToVariants(product);
      const firstSku = product.variantsInfo?.variants?.find((v) => v.sku?.trim())?.sku ?? null;
      const rows = remoteRowsFromMatrix(matrix, firstSku);
      if (rows.length > 0) return { provider: "wix", rows };
    } catch {
      /* try next site-id option */
    }
  }

  return { provider: "wix", rows: v1Rows };
}

export async function hydrateLinkSkus(args: {
  ctx: ChannelConnectionContext;
  provider: ChannelProvider;
  externalListingId: string;
  item: SyncStoreItem;
  linkOrigin?: string | null;
}): Promise<HydratedChannelSkus> {
  try {
    if (args.provider === "ebay") {
      return await hydrateEbay(args.ctx, args.item, {
        externalListingId: args.externalListingId,
        linkOrigin: args.linkOrigin,
      });
    }
    if (args.provider === "etsy") {
      return await hydrateEtsy(args.ctx, args.externalListingId);
    }
    if (args.provider === "shopify") {
      return await hydrateShopify(args.ctx, args.externalListingId);
    }
    if (args.provider === "wix") {
      return await hydrateWix(args.ctx, args.externalListingId);
    }
    return { provider: args.provider, rows: [], error: `Unsupported provider ${args.provider}` };
  } catch (e) {
    return {
      provider: args.provider,
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
