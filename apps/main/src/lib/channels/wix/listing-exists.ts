import type { ChannelConnectionContext } from "../types";
import { WixApiError, wixGet, type WixRequestOpts } from "./client";
import { isWixProductVisibleOnSite, type WixProduct, type WixV1Product } from "./mapping";
import { wixInventoryRequestOpts } from "./site";

export type WixListingExistence = "exists" | "gone" | "unknown";

/** Map a Wix product GET to exists / gone / unknown without treating API failures as deletes. */
export function wixListingExistenceFromFetch(args: {
  status: number | null;
  product: { id?: string; visible?: boolean } | null;
}): WixListingExistence {
  if (args.status === 404) return "gone";
  if (args.status === 401 || args.status === 403) return "unknown";
  if (args.status != null && args.status >= 500) return "unknown";
  if (args.status != null && args.status >= 400) return "unknown";
  if (!args.product?.id) return "gone";
  return isWixProductVisibleOnSite(args.product) ? "exists" : "gone";
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
    if (e instanceof WixApiError && e.status === 404) return "gone";
    return "unknown";
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
    if (e instanceof WixApiError && e.status === 404) return "gone";
    return "unknown";
  }
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

  let sawGone = false;
  for (const opts of wixInventoryRequestOpts(ctx)) {
    const v3 = await fetchV3Product(ctx.accessToken, id, opts);
    if (v3 === "exists") return false;
    if (v3 === "gone") {
      const v1 = await fetchV1Product(ctx.accessToken, id, opts);
      if (v1 === "exists") return false;
      if (v1 === "gone") sawGone = true;
      continue;
    }
    const v1 = await fetchV1Product(ctx.accessToken, id, opts);
    if (v1 === "exists") return false;
    if (v1 === "gone") sawGone = true;
  }
  return sawGone;
}
