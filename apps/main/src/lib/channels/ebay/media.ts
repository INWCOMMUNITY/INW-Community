import { ebayGet, ebayJson } from "./client";
import { EBAY_APIZ_BASE } from "./config";
import { marketplaceCdnFamily } from "../photo-urls";
import {
  isEbayCdnGalleryPhotoUrl,
  isEbayTrueEpsPictureUrl,
  sanitizeEbayPhotoUrlForInventoryPut,
} from "./photos";

const IMAGE_RELATED_ERROR = /#25014|#25015|image|photo|picture|hosted/i;

export type EbayInventoryPictureFamily = "eps" | "cdn" | "self";

export function isEbayImageRelatedInventoryError(message: string | null | undefined): boolean {
  return IMAGE_RELATED_ERROR.test(message ?? "");
}

export function isEbayMixedHostPictureError(message: string | null | undefined): boolean {
  return /mixture of self hosted and eps|self hosted and eps pictures/i.test(message ?? "");
}

/** eBay Picture Services host — cannot be mixed with seller/INW URLs on one listing. */
export function isEbayEpsImageUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  const href = raw.startsWith("//") ? `https:${raw}` : raw.replace(/^http:\/\//i, "https://");
  try {
    const host = new URL(href).hostname.toLowerCase();
    return (
      host === "i.ebayimg.com" ||
      host.endsWith(".ebayimg.com") ||
      host === "ebaystatic.com" ||
      host.endsWith(".ebaystatic.com")
    );
  } catch {
    return /ebayimg\.com|ebaystatic\.com/i.test(raw);
  }
}

export function isEbayHostedImageUrl(url: string): boolean {
  return isEbayEpsImageUrl(url);
}

export function ebayInventoryPictureFamily(url: string): EbayInventoryPictureFamily {
  if (isEbayTrueEpsPictureUrl(url)) return "eps";
  if (isEbayCdnGalleryPhotoUrl(url) || isEbayEpsImageUrl(url)) return "cdn";
  return "self";
}

export function inventoryImageUrlsAreMixedHostFamily(urls: string[]): boolean {
  let hasEps = false;
  let hasCdn = false;
  let hasSelf = false;
  for (const url of urls) {
    const family = ebayInventoryPictureFamily(url);
    if (family === "eps") hasEps = true;
    else if (family === "cdn") hasCdn = true;
    else hasSelf = true;
    if ((hasEps && hasCdn) || (hasEps && hasSelf) || (hasCdn && hasSelf)) return true;
  }
  return false;
}

export function ebayPhotosAreHostFamilyMismatchOnly(live: string[], inw: string[]): boolean {
  if (live.length === 0 || inw.length === 0) return false;
  const liveHosted = live.every((url) => ebayInventoryPictureFamily(url) !== "self");
  const inwSelf = inw.every((url) => ebayInventoryPictureFamily(url) === "self");
  const liveSelf = live.every((url) => ebayInventoryPictureFamily(url) === "self");
  const inwHosted = inw.every((url) => ebayInventoryPictureFamily(url) !== "self");
  return (liveHosted && inwSelf) || (liveSelf && inwHosted);
}

export function readStoredPhotoUrls(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

/**
 * Imported listings keep the live eBay gallery.
 * Overlaying Shopify/INW URLs onto EPS causes #25014. First publish (no live pin)
 * can still send INW photos.
 */
export function selectPassthroughInventoryImageUrls(liveUrls: string[], inwUrls: string[]): string[] {
  const livePin = liveEbayPhotoUrlsToPin(liveUrls);
  if (livePin.length > 0) return livePin;
  return normalizeInventoryImageUrls(inwUrls);
}

/** HTTPS image URL for Inventory PUT. Same-family size bump only — never EPS→CDN rewrite. */
export function sanitizeInventoryImageUrl(raw: string): string | null {
  return sanitizeEbayPhotoUrlForInventoryPut(raw);
}

export function normalizeInventoryImageUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    const sanitized = sanitizeInventoryImageUrl(raw);
    if (sanitized && !out.includes(sanitized)) out.push(sanitized);
  }
  return out.slice(0, 12);
}

function pickUniformPictureFamily(urls: string[]): string[] {
  const unique = urls.slice(0, 12);
  if (!inventoryImageUrlsAreMixedHostFamily(unique)) {
    return unique.filter((url) => !isForeignMarketplaceCdnPhotoUrl(url));
  }
  const eps = unique.filter((url) => ebayInventoryPictureFamily(url) === "eps");
  if (eps.length > 0) return eps;
  const cdn = unique.filter((url) => ebayInventoryPictureFamily(url) === "cdn");
  if (cdn.length > 0) return cdn;
  return unique.filter((url) => !isForeignMarketplaceCdnPhotoUrl(url));
}

/** HTTPS-only live URLs with mixed families stripped — no size rewrite (#25014 retry). */
export function rawLiveInventoryImageUrls(urls: string[]): string[] {
  const httpsOnly: string[] = [];
  for (const raw of urls) {
    let url = raw.trim();
    if (!url) continue;
    if (url.startsWith("//")) url = `https:${url}`;
    if (url.startsWith("http://")) url = `https://${url.slice("http://".length)}`;
    if (!url.startsWith("https://")) continue;
    if (!httpsOnly.includes(url)) httpsOnly.push(url);
  }
  return pickUniformPictureFamily(httpsOnly);
}

export function readInventoryProductImageUrls(body: Record<string, unknown>): string[] {
  const product =
    body.product && typeof body.product === "object"
      ? (body.product as Record<string, unknown>)
      : null;
  if (!Array.isArray(product?.imageUrls)) return [];
  return product.imageUrls.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

export function withInventoryProductImageUrls(
  body: Record<string, unknown>,
  imageUrls: string[]
): Record<string, unknown> {
  const product =
    body.product && typeof body.product === "object"
      ? { ...(body.product as Record<string, unknown>) }
      : {};
  return { ...body, product: { ...product, imageUrls } };
}

export function omitInventoryProductImageUrls(body: Record<string, unknown>): Record<string, unknown> {
  const product =
    body.product && typeof body.product === "object"
      ? { ...(body.product as Record<string, unknown>) }
      : {};
  delete product.imageUrls;
  return { ...body, product };
}

/** Shopify/Etsy/Wix CDNs are not eBay pictures — sending them onto EPS causes #25014. */
export function isForeignMarketplaceCdnPhotoUrl(url: string): boolean {
  const family = marketplaceCdnFamily(url);
  return family === "shopify" || family === "etsy" || family === "wix";
}

/**
 * Pictures already on the live inventory item. Inventory PUT is a full replace —
 * omitting imageUrls deletes the published gallery. Prefer EPS so we never mix
 * host families (#25014). Never pin Shopify/Etsy/Wix CDNs.
 */
export function liveEbayPhotoUrlsToPin(liveUrls: string[]): string[] {
  const eps = epsFamilyImageUrls(liveUrls);
  if (eps.length > 0) return eps;
  return uniformHostFamilyImageUrls(liveUrls).filter((url) => !isForeignMarketplaceCdnPhotoUrl(url));
}

/**
 * Echo Inventory GET when it has a pin-able gallery. GetItem is only a fallback when
 * inventory has no pictures — and those URLs must already be PUT-sanitized (no display rewrite).
 */
export function mergeLiveEbayPhotoUrls(inventoryUrls: string[], tradingUrls: string[]): string[] {
  const inventoryPin = liveEbayPhotoUrlsToPin(inventoryUrls);
  if (inventoryPin.length > 0) return inventoryPin;
  return liveEbayPhotoUrlsToPin(tradingUrls);
}

/**
 * Existing eBay listings already have pictures. Sending INW blob URLs onto an
 * EPS listing causes #25014. Pin live pictures of one host family. Only omit
 * imageUrls when live inventory truly has none — otherwise PUT would wipe them.
 */
export function applyEbayInventoryPhotoPolicy(
  body: Record<string, unknown>,
  args: { liveImageUrls: string[]; inwPhotos: string[]; pushInwPhotos: boolean }
): Record<string, unknown> {
  if (args.pushInwPhotos) {
    const pinned = selectPassthroughInventoryImageUrls(args.liveImageUrls, args.inwPhotos);
    return pinned.length > 0 ? withInventoryProductImageUrls(body, pinned) : body;
  }
  const live = liveEbayPhotoUrlsToPin(args.liveImageUrls);
  if (live.length > 0) return withInventoryProductImageUrls(body, live);
  return omitInventoryProductImageUrls(body);
}

function urlsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, i) => url === b[i]);
}

/** Upload one image URL to eBay Media and return the hosted image URL. */
export async function uploadEbayImageFromUrl(
  accessToken: string,
  imageUrl: string
): Promise<string | null> {
  const source = imageUrl.trim();
  if (!source) return null;
  try {
    const created = await ebayJson<{ imageId?: string }>(
      accessToken,
      `${EBAY_APIZ_BASE}/commerce/media/v1_beta/image/create_image_from_url`,
      "POST",
      { imageUrl: source }
    );
    const imageId = created.imageId?.trim();
    if (!imageId) return null;
    const details = await ebayGet<{ imageUrl?: string }>(
      accessToken,
      `${EBAY_APIZ_BASE}/commerce/media/v1_beta/image/${encodeURIComponent(imageId)}`
    );
    return details.imageUrl?.trim() || null;
  } catch (e) {
    console.warn("[ebay] uploadEbayImageFromUrl failed", {
      imageUrl: source,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Replace non-eBay image URLs with eBay-hosted URLs where possible. */
export async function ensureEbayHostedPhotoUrls(
  accessToken: string,
  photoUrls: string[],
  options?: { forceHost?: boolean }
): Promise<string[]> {
  const forceHost = options?.forceHost === true;
  const out: string[] = [];
  for (const raw of photoUrls) {
    const url = sanitizeInventoryImageUrl(raw) ?? raw.trim();
    if (!url) continue;
    if (isEbayHostedImageUrl(url)) {
      // Never send EPS through create_image_from_url — eBay returns HTTP 500 HTML.
      out.push(url);
      continue;
    }
    const hosted = await uploadEbayImageFromUrl(accessToken, url);
    if (hosted) {
      out.push(hosted);
    } else if (!forceHost) {
      out.push(url);
    }
  }
  return out.slice(0, 12);
}

function epsFamilyImageUrls(urls: string[]): string[] {
  return normalizeInventoryImageUrls(urls.filter((url) => ebayInventoryPictureFamily(url) === "eps"));
}

/** Drop mixed EPS + CDN + self-hosted URLs; prefer EPS so Inventory PUT does not return #25014. */
export function uniformHostFamilyImageUrls(urls: string[]): string[] {
  const normalized = normalizeInventoryImageUrls(urls);
  if (!inventoryImageUrlsAreMixedHostFamily(normalized)) return normalized;
  const eps = normalized.filter((url) => ebayInventoryPictureFamily(url) === "eps");
  if (eps.length > 0) return eps;
  const cdn = normalized.filter((url) => ebayInventoryPictureFamily(url) === "cdn");
  if (cdn.length > 0) return cdn;
  return normalized.filter((url) => !isForeignMarketplaceCdnPhotoUrl(url));
}

/**
 * PUT inventory with photo recovery for #25014/#25015.
 * Never send mixed EPS + self-hosted URLs. On mix errors, pin raw live GET URLs.
 */
export async function putInventoryWithPhotoRecovery<T>(args: {
  accessToken: string;
  body: Record<string, unknown>;
  put: (payload: Record<string, unknown>) => Promise<T>;
  fallbackImageUrls?: string[];
  liveImageUrls?: string[];
  describeError?: (e: unknown) => string;
  /** When true, first publish may send INW blob URLs. Default false for existing listings. */
  allowInwPhotoUpload?: boolean;
}): Promise<T> {
  const describe = args.describeError ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const allowInwPhotoUpload = args.allowInwPhotoUpload === true;
  const liveImageUrls = args.liveImageUrls ?? [];
  const livePinned = liveEbayPhotoUrlsToPin(liveImageUrls);
  const liveEps = epsFamilyImageUrls(liveImageUrls);
  const rawLive = rawLiveInventoryImageUrls(liveImageUrls);
  let urls = liveEbayPhotoUrlsToPin(readInventoryProductImageUrls(args.body));
  if (!allowInwPhotoUpload) {
    urls = livePinned;
  } else if (livePinned.length > 0 && (urls.length === 0 || urls.some((url) => ebayInventoryPictureFamily(url) === "self"))) {
    urls = livePinned;
  } else if (liveEps.length > 0 && (urls.length === 0 || urls.some((url) => ebayInventoryPictureFamily(url) !== "eps"))) {
    urls = liveEps;
  }
  const payload =
    urls.length > 0
      ? withInventoryProductImageUrls(args.body, urls)
      : allowInwPhotoUpload
        ? args.body
        : livePinned.length > 0
          ? withInventoryProductImageUrls(args.body, livePinned)
          : omitInventoryProductImageUrls(args.body);

  try {
    return await args.put(payload);
  } catch (e) {
    const message = describe(e);
    if (!isEbayImageRelatedInventoryError(message)) throw e;

    const current = normalizeInventoryImageUrls(readInventoryProductImageUrls(payload));
    if (rawLive.length > 0 && !urlsMatch(rawLive, current)) {
      try {
        return await args.put(withInventoryProductImageUrls(payload, rawLive));
      } catch (liveErr) {
        throw liveErr;
      }
    }
    if (liveEps.length > 0 && !urlsMatch(liveEps, current)) {
      try {
        return await args.put(withInventoryProductImageUrls(payload, liveEps));
      } catch (liveErr) {
        throw liveErr;
      }
    }
    throw e;
  }
}
