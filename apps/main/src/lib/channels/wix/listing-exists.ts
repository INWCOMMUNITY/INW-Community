import type { ChannelConnectionContext } from "../types";
import { wixCatalogApiFromConn } from "./catalog-api";
import { WixApiError, wixGet, wixJson, type WixRequestOpts } from "./client";
import { isWixProductVisibleOnSite, type WixProduct, type WixV1Product } from "./mapping";
import { remintWixAccessToken, wixInventoryRequestOpts } from "./site";

export type WixListingExistence = "exists" | "gone" | "unknown";

/** Map a Wix product GET/query to exists / gone / unknown without treating API failures as deletes. */
export function wixListingExistenceFromFetch(args: {
  status: number | null;
  product: { id?: string; visible?: boolean } | null;
  message?: string;
}): WixListingExistence {
  if (args.status != null && isWixNotFoundStatus(args.status, args.message)) return "gone";
  if (args.status === 401 || args.status === 403) return "unknown";
  if (args.status != null && args.status >= 500) return "unknown";
  if (args.status != null && args.status >= 400) return "unknown";
  if (!args.product?.id) return "gone";
  return isWixProductVisibleOnSite(args.product) ? "exists" : "gone";
}

export function isWixNotFoundStatus(status: number, message?: string): boolean {
  if (status === 404) return true;
  if (!message) return false;
  return /not found|does not exist|product_not_found|already deleted|entity not found/i.test(
    message
  );
}

/**
 * GET 404/hidden wins. An empty query is gone only when GET does not still
 * show a live product (avoids flagging every item if the query filter is ignored).
 */
export function wixDecideGone(args: {
  query: WixListingExistence;
  get: WixListingExistence;
}): boolean {
  if (args.get === "gone") return true;
  return args.query === "gone" && args.get !== "exists";
}

function existenceFromCaught(e: unknown): WixListingExistence {
  if (e instanceof WixApiError) {
    return wixListingExistenceFromFetch({
      status: e.status,
      product: null,
      message: e.message,
    });
  }
  return "unknown";
}

async function fetchV3Product(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<WixListingExistence> {
  try {
    const res = await wixGet<{ product?: WixProduct }>(
      accessToken,
      `/stores/v3/products/${encodeURIComponent(productId)}?fields=MEDIA_ITEMS_INFO&fields=PLAIN_DESCRIPTION`,
      opts
    );
    return wixListingExistenceFromFetch({ status: null, product: res.product ?? null });
  } catch (e) {
    return existenceFromCaught(e);
  }
}

async function fetchV1Product(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<WixListingExistence> {
  try {
    const res = await wixGet<{ product?: WixV1Product }>(
      accessToken,
      `/stores/v1/products/${encodeURIComponent(productId)}`,
      opts
    );
    return wixListingExistenceFromFetch({ status: null, product: res.product ?? null });
  } catch (e) {
    return existenceFromCaught(e);
  }
}

async function queryV3ById(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<WixListingExistence> {
  try {
    const res = await wixJson<{ products?: WixProduct[] }>(
      accessToken,
      "/stores/v3/products/query",
      "POST",
      {
        query: {
          filter: { id: { $eq: productId } },
          cursorPaging: { limit: 1 },
        },
      },
      opts
    );
    return wixListingExistenceFromFetch({ status: null, product: res.products?.[0] ?? null });
  } catch (e) {
    return existenceFromCaught(e);
  }
}

async function queryV1ById(
  accessToken: string,
  productId: string,
  opts: WixRequestOpts
): Promise<WixListingExistence> {
  try {
    const res = await wixJson<{ products?: WixV1Product[] }>(
      accessToken,
      "/stores/v1/products/query",
      "POST",
      {
        query: {
          filter: { id: { $eq: productId } },
          paging: { limit: 1, offset: 0 },
        },
      },
      opts
    );
    return wixListingExistenceFromFetch({ status: null, product: res.products?.[0] ?? null });
  } catch (e) {
    return existenceFromCaught(e);
  }
}

async function probeOnce(
  ctx: ChannelConnectionContext,
  productId: string
): Promise<WixListingExistence[]> {
  const preferV1 = wixCatalogApiFromConn(ctx) === "v1";
  const signals: WixListingExistence[] = [];
  for (const opts of wixInventoryRequestOpts(ctx)) {
    const query = preferV1
      ? await queryV1ById(ctx.accessToken, productId, opts)
      : await queryV3ById(ctx.accessToken, productId, opts);
    const got = preferV1
      ? await fetchV1Product(ctx.accessToken, productId, opts)
      : await fetchV3Product(ctx.accessToken, productId, opts);
    signals.push(query, got);
    if (wixDecideGone({ query, get: got }) || got === "exists" || query === "exists") {
      return signals;
    }

    const otherQuery = preferV1
      ? await queryV3ById(ctx.accessToken, productId, opts)
      : await queryV1ById(ctx.accessToken, productId, opts);
    const otherGet = preferV1
      ? await fetchV3Product(ctx.accessToken, productId, opts)
      : await fetchV1Product(ctx.accessToken, productId, opts);
    signals.push(otherQuery, otherGet);
    if (wixDecideGone({ query: otherQuery, get: otherGet }) || otherGet === "exists") {
      return signals;
    }
  }
  return signals;
}

/**
 * True when the Wix product is deleted or hidden. API/auth failures return false
 * so we do not flag Needs Attention on a glitch.
 */
export async function wixProductIsGone(
  ctx: ChannelConnectionContext,
  productId: string
): Promise<boolean> {
  const id = productId.trim();
  if (!id) return false;

  let signals = await probeOnce(ctx, id);
  const decided = (list: WixListingExistence[]) => {
    for (let i = 0; i + 1 < list.length; i += 2) {
      if (wixDecideGone({ query: list[i], get: list[i + 1] })) return true;
    }
    return false;
  };
  if (!decided(signals) && !signals.includes("exists")) {
    if (await remintWixAccessToken(ctx)) {
      signals = await probeOnce(ctx, id);
    }
  }

  const gone = decided(signals);
  if (gone) {
    console.info("[wix] product gone", { productId: id, signals });
  }
  return gone;
}
