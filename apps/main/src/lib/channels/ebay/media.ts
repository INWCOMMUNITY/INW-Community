import { ebayGet, ebayJson } from "./client";
import { EBAY_APIZ_BASE } from "./config";
import { upgradeEbayCdnPhotoUrl } from "./photos";

const IMAGE_RELATED_ERROR = /#25014|#25015|image|photo|picture|hosted/i;

export function isEbayImageRelatedInventoryError(message: string | null | undefined): boolean {
  return IMAGE_RELATED_ERROR.test(message ?? "");
}

export function isEbayMixedHostPictureError(message: string | null | undefined): boolean {
  return /mixture of self hosted and eps|self hosted and eps pictures/i.test(message ?? "");
}

/** eBay Picture Services (EPS) CDN — cannot be mixed with self-hosted URLs on one listing. */
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

export function inventoryImageUrlsAreMixedHostFamily(urls: string[]): boolean {
  let hasEps = false;
  let hasSelf = false;
  for (const url of urls) {
    if (isEbayEpsImageUrl(url)) hasEps = true;
    else hasSelf = true;
    if (hasEps && hasSelf) return true;
  }
  return false;
}

export function ebayPhotosAreHostFamilyMismatchOnly(live: string[], inw: string[]): boolean {
  if (live.length === 0 || inw.length === 0) return false;
  const liveAllEps = live.every(isEbayEpsImageUrl);
  const inwAllSelf = inw.every((url) => !isEbayEpsImageUrl(url));
  const liveAllSelf = live.every((url) => !isEbayEpsImageUrl(url));
  const inwAllEps = inw.every(isEbayEpsImageUrl);
  return (liveAllEps && inwAllSelf) || (liveAllSelf && inwAllEps);
}

export function readStoredPhotoUrls(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

/**
 * Imported listings keep EPS pictures on the published eBay item.
 * Overlaying INW blob/Media URLs mixes host families and eBay returns #25014.
 */
export function selectPassthroughInventoryImageUrls(liveUrls: string[], inwUrls: string[]): string[] {
  const live = normalizeInventoryImageUrls(liveUrls);
  const inw = normalizeInventoryImageUrls(inwUrls);
  if (inw.length === 0) return live;
  if (live.length === 0) return inw;
  if (inventoryImageUrlsAreMixedHostFamily(inw)) {
    return live.every(isEbayEpsImageUrl) ? live : inw.filter(isEbayEpsImageUrl);
  }
  const liveAllEps = live.every(isEbayEpsImageUrl);
  const inwHasSelf = inw.some((url) => !isEbayEpsImageUrl(url));
  if (liveAllEps && inwHasSelf) return live;
  return inw;
}

/** HTTPS image URL for Inventory PUT. Upsize eBay thumbs so they meet the 500px Picture Policy. */
export function sanitizeInventoryImageUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("http://")) url = `https://${url.slice("http://".length)}`;
  if (!url.startsWith("https://")) return null;
  return isEbayEpsImageUrl(url) ? upgradeEbayCdnPhotoUrl(url) : url;
}

export function normalizeInventoryImageUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    const sanitized = sanitizeInventoryImageUrl(raw);
    if (sanitized && !out.includes(sanitized)) out.push(sanitized);
  }
  return out.slice(0, 12);
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

/**
 * Existing eBay listings already have EPS copies. Sending INW blob URLs causes #25014.
 * Only overlay INW photos when the seller changed them on the INW listing.
 */
export function applyEbayInventoryPhotoPolicy(
  body: Record<string, unknown>,
  args: { liveImageUrls: string[]; inwPhotos: string[]; pushInwPhotos: boolean }
): Record<string, unknown> {
  if (args.pushInwPhotos) {
    const pinned = selectPassthroughInventoryImageUrls(args.liveImageUrls, args.inwPhotos);
    return pinned.length > 0 ? withInventoryProductImageUrls(body, pinned) : body;
  }
  const live = normalizeInventoryImageUrls(args.liveImageUrls);
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

function epsOnlyImageUrls(urls: string[]): string[] {
  return normalizeInventoryImageUrls(urls.filter(isEbayEpsImageUrl));
}

function uniformHostFamilyImageUrls(urls: string[]): string[] {
  const normalized = normalizeInventoryImageUrls(urls);
  if (!inventoryImageUrlsAreMixedHostFamily(normalized)) return normalized;
  const eps = epsOnlyImageUrls(normalized);
  return eps.length > 0 ? eps : normalized.filter((url) => !isEbayEpsImageUrl(url));
}

/**
 * PUT inventory with photo recovery for #25014/#25015.
 * Never send mixed EPS + self-hosted URLs. On mix errors, pin live EPS instead of INW blobs.
 */
export async function putInventoryWithPhotoRecovery<T>(args: {
  accessToken: string;
  body: Record<string, unknown>;
  put: (payload: Record<string, unknown>) => Promise<T>;
  fallbackImageUrls?: string[];
  liveImageUrls?: string[];
  describeError?: (e: unknown) => string;
  /** When false, never upload or fall back to INW blob URLs (existing listing, photos unchanged). */
  allowInwPhotoUpload?: boolean;
}): Promise<T> {
  const describe = args.describeError ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const allowInwPhotoUpload = args.allowInwPhotoUpload !== false;
  const liveEps = epsOnlyImageUrls(args.liveImageUrls ?? []);
  let urls = uniformHostFamilyImageUrls(readInventoryProductImageUrls(args.body));
  if (liveEps.length > 0 && urls.some((url) => !isEbayEpsImageUrl(url))) {
    urls = liveEps;
  }
  if (!allowInwPhotoUpload && urls.some((url) => !isEbayEpsImageUrl(url))) {
    urls = liveEps;
  }
  let payload =
    urls.length > 0
      ? withInventoryProductImageUrls(args.body, urls)
      : allowInwPhotoUpload
        ? args.body
        : omitInventoryProductImageUrls(args.body);

  if (allowInwPhotoUpload && urls.some((url) => !isEbayHostedImageUrl(url)) && liveEps.length === 0) {
    const hosted = await ensureEbayHostedPhotoUrls(args.accessToken, urls);
    if (hosted.length > 0) {
      const uniform = uniformHostFamilyImageUrls(hosted);
      payload = withInventoryProductImageUrls(payload, uniform.length > 0 ? uniform : hosted);
    }
  }

  try {
    return await args.put(payload);
  } catch (e) {
    const message = describe(e);
    if (!isEbayImageRelatedInventoryError(message)) throw e;

    const current = normalizeInventoryImageUrls(readInventoryProductImageUrls(payload));
    if (liveEps.length > 0 && !urlsMatch(liveEps, current)) {
      try {
        return await args.put(withInventoryProductImageUrls(payload, liveEps));
      } catch (liveErr) {
        e = liveErr;
      }
    }

    if (isEbayMixedHostPictureError(describe(e)) && liveEps.length > 0) {
      throw e;
    }

    if (liveEps.length === 0 && allowInwPhotoUpload) {
      const hosted = await ensureEbayHostedPhotoUrls(args.accessToken, current, { forceHost: true });
      const uniformHosted = uniformHostFamilyImageUrls(hosted);
      if (uniformHosted.length > 0 && !urlsMatch(uniformHosted, current)) {
        try {
          return await args.put(withInventoryProductImageUrls(payload, uniformHosted));
        } catch (hostedErr) {
          e = hostedErr;
        }
      }
    }

    const fallback = allowInwPhotoUpload
      ? uniformHostFamilyImageUrls(args.fallbackImageUrls ?? [])
      : [];
    if (fallback.length === 0) throw e;
    if (liveEps.length > 0 && fallback.some((url) => !isEbayEpsImageUrl(url))) throw e;

    const hostedFallback = await ensureEbayHostedPhotoUrls(args.accessToken, fallback, {
      forceHost: true,
    });
    const retryUrls = uniformHostFamilyImageUrls(
      hostedFallback.length > 0 ? hostedFallback : fallback
    );
    if (retryUrls.length === 0 || urlsMatch(retryUrls, current)) throw e;
    return await args.put(withInventoryProductImageUrls(payload, retryUrls));
  }
}
