import type { ChannelConnectionContext } from "../types";
import { wixCatalogApiFromConn } from "./catalog-api";
import { wixJson, type WixRequestOpts } from "./client";
import { isWixProductVisibleOnSite, type WixProduct, type WixV1Product } from "./mapping";
import { wixInventoryRequestOpts } from "./site";

const MAX_PAGES = 20;

export function wixLinkMissingFromLiveCatalog(
  externalListingId: string,
  liveIds: Set<string>
): boolean {
  return !liveIds.has(externalListingId.trim());
}

async function queryV3Ids(
  accessToken: string,
  opts: WixRequestOpts
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let cursor: string | undefined;
  let truncated = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await wixJson<{
      products?: WixProduct[];
      pagingMetadata?: { cursors?: { next?: string | null } };
    }>(
      accessToken,
      "/stores/v3/products/query",
      "POST",
      { query: { cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) } } },
      opts
    );
    const products = res.products ?? [];
    for (const p of products) {
      if (p.id && isWixProductVisibleOnSite(p)) ids.push(p.id);
    }
    const next = res.pagingMetadata?.cursors?.next;
    if (!next || products.length === 0) {
      truncated = false;
      break;
    }
    cursor = next;
  }
  return { ids, truncated };
}

async function queryV1Ids(
  accessToken: string,
  path: "/stores/v1/products/query" | "/stores-reader/v1/products/query",
  opts: WixRequestOpts
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let offset = 0;
  let truncated = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await wixJson<{ products?: WixV1Product[] }>(
      accessToken,
      path,
      "POST",
      { query: { paging: { limit: 100, offset } } },
      opts
    );
    const products = res.products ?? [];
    for (const p of products) {
      if (p.id && isWixProductVisibleOnSite(p)) ids.push(p.id);
    }
    if (products.length < 100) {
      truncated = false;
      break;
    }
    offset += products.length;
  }
  return { ids, truncated };
}

export async function listLiveWixProductIds(
  ctx: ChannelConnectionContext
): Promise<{ ids: string[]; truncated: boolean } | null> {
  const preferV1 = wixCatalogApiFromConn(ctx) === "v1";
  const attempts: Array<() => Promise<{ ids: string[]; truncated: boolean }>> = [];
  for (const opts of wixInventoryRequestOpts(ctx)) {
    if (preferV1) {
      attempts.push(() => queryV1Ids(ctx.accessToken, "/stores/v1/products/query", opts));
      attempts.push(() => queryV1Ids(ctx.accessToken, "/stores-reader/v1/products/query", opts));
      attempts.push(() => queryV3Ids(ctx.accessToken, opts));
    } else {
      attempts.push(() => queryV3Ids(ctx.accessToken, opts));
      attempts.push(() => queryV1Ids(ctx.accessToken, "/stores/v1/products/query", opts));
      attempts.push(() => queryV1Ids(ctx.accessToken, "/stores-reader/v1/products/query", opts));
    }
  }

  let empty: { ids: string[]; truncated: boolean } | null = null;
  for (const run of attempts) {
    try {
      const result = await run();
      if (result.ids.length > 0) return result;
      empty = result;
    } catch (e) {
      console.warn("[wix] live id list failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return empty;
}
