import { wixJson, type WixRequestOpts } from "./client";
import { resolveWixCatalogMode } from "./catalog-api";
import { fetchWixV1Product } from "./collections";
import { ensureWixSiteId, wixSiteIdFromConn } from "./site";
import { v1Photos, type WixProduct } from "./mapping";
import { wixGet } from "./client";
import type { ChannelConnectionContext } from "../types";
import {
  resolveWixProductMediaRefs,
  type WixProductMediaRef,
} from "./media-import";

type ProductResponse = { product?: WixProduct };

/** Payload for Catalog v1 Add Product Media (mediaId preferred, url fallback). */
export function buildWixV1AddProductMediaPayload(
  refs: WixProductMediaRef[]
): { media: Array<{ mediaId?: string; url?: string }> } | null {
  if (refs.length === 0) return null;
  return {
    media: refs.map((r) =>
      "mediaId" in r ? { mediaId: r.mediaId } : { url: r.url }
    ),
  };
}

/**
 * Catalog v1: media on create/PATCH is ignored — use Add Product Media after the product exists.
 * @see https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/add-product-media
 */
export async function pushWixV1ProductMedia(
  accessToken: string,
  productId: string,
  photos: string[],
  opts: WixRequestOpts,
  replace = false
): Promise<void> {
  const refs = await resolveWixProductMediaRefs(accessToken, photos, opts);
  const payload = buildWixV1AddProductMediaPayload(refs);
  if (!payload) return;

  if (replace) {
    await wixJson(
      accessToken,
      `/stores/v1/products/${encodeURIComponent(productId)}/media/delete`,
      "POST",
      { mediaIds: [] },
      opts
    ).catch(() => {});
  } else {
    const existing = await fetchWixV1Product(accessToken, productId, opts);
    if (existing && v1Photos(existing).length > 0) return;
  }

  await wixJson(
    accessToken,
    `/stores/v1/products/${encodeURIComponent(productId)}/media`,
    "POST",
    payload,
    opts
  );
  const mediaIds = refs.filter((r) => "mediaId" in r).length;
  console.info("[wix] pushWixV1ProductMedia ok", {
    productId,
    count: payload.media.length,
    mediaIds,
    replace,
  });
}

async function pushWixV3ProductMediaIfMissing(
  accessToken: string,
  productId: string,
  photos: string[],
  opts: WixRequestOpts
): Promise<void> {
  if (photos.length === 0) return;
  const res = await wixGet<ProductResponse>(
    accessToken,
    `/stores/v3/products/${encodeURIComponent(productId)}?fields=MEDIA_ITEMS_INFO`,
    opts
  ).catch(() => null);
  const product = res?.product;
  if (!product?.revision) return;
  const hasMedia =
    Boolean(product.media?.main?.url || product.media?.main?.image?.url) ||
    (product.media?.itemsInfo?.items?.length ?? 0) > 0;
  if (hasMedia) return;
  const refs = await resolveWixProductMediaRefs(accessToken, photos, opts);
  const items = refs.map((r) =>
    "mediaId" in r ? { url: r.wixUrl } : { url: r.url }
  );
  await wixJson(
    accessToken,
    `/stores/v3/products/${encodeURIComponent(productId)}`,
    "PATCH",
    {
      product: {
        revision: product.revision,
        media: { itemsInfo: { items } },
      },
    },
    opts
  );
  console.info("[wix] pushWixV3ProductMediaIfMissing ok", {
    productId,
    count: items.length,
  });
}

/** Push listing photos to Wix when the catalog API does not accept media on create/PATCH. */
export async function syncWixProductMedia(
  conn: ChannelConnectionContext,
  productId: string,
  photos: string[],
  options: { replace?: boolean } = {}
): Promise<void> {
  if (photos.length === 0) return;
  await ensureWixSiteId(conn);
  const mode = await resolveWixCatalogMode(conn);
  const siteId = wixSiteIdFromConn(conn);
  const opts: WixRequestOpts = siteId ? { siteId } : {};
  const replace = options.replace ?? false;

  if (mode === "v1") {
    await pushWixV1ProductMedia(conn.accessToken, productId, photos, opts, replace);
    return;
  }
  if (mode === "v3" || mode === "unknown") {
    await pushWixV3ProductMediaIfMissing(conn.accessToken, productId, photos, opts);
  }
}
