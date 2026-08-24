import { ebayGet, ebayJson } from "./client";
import { EBAY_APIZ_BASE } from "./config";

const IMAGE_RELATED_ERROR = /#25014|#25015|image|photo|picture|hosted/i;

export function isEbayImageRelatedInventoryError(message: string | null | undefined): boolean {
  return IMAGE_RELATED_ERROR.test(message ?? "");
}

export function isEbayHostedImageUrl(url: string): boolean {
  return /^https:\/\/i\.ebayimg\.com\//i.test(url.trim());
}

/** HTTPS image URL for Inventory PUT — do not upscale eBay CDN sizes (that can 25014). */
export function sanitizeInventoryImageUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("http://")) url = `https://${url.slice("http://".length)}`;
  if (!url.startsWith("https://")) return null;
  return url;
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
    if (!forceHost && isEbayHostedImageUrl(url)) {
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

/**
 * PUT inventory with photo recovery for #25014/#25015.
 * Hosts non-eBay URLs first; on picture errors re-hosts every URL, then falls back to INW photos.
 */
export async function putInventoryWithPhotoRecovery<T>(args: {
  accessToken: string;
  body: Record<string, unknown>;
  put: (payload: Record<string, unknown>) => Promise<T>;
  fallbackImageUrls?: string[];
  describeError?: (e: unknown) => string;
}): Promise<T> {
  const describe = args.describeError ?? ((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const initialUrls = normalizeInventoryImageUrls(readInventoryProductImageUrls(args.body));
  let payload =
    initialUrls.length > 0 ? withInventoryProductImageUrls(args.body, initialUrls) : args.body;

  if (initialUrls.some((url) => !isEbayHostedImageUrl(url))) {
    const hosted = await ensureEbayHostedPhotoUrls(args.accessToken, initialUrls);
    if (hosted.length > 0) {
      payload = withInventoryProductImageUrls(payload, hosted);
    }
  }

  try {
    return await args.put(payload);
  } catch (e) {
    if (!isEbayImageRelatedInventoryError(describe(e))) throw e;

    const current = normalizeInventoryImageUrls(readInventoryProductImageUrls(payload));
    const hosted = await ensureEbayHostedPhotoUrls(args.accessToken, current, { forceHost: true });
    if (hosted.length > 0 && !urlsMatch(hosted, current)) {
      try {
        return await args.put(withInventoryProductImageUrls(payload, hosted));
      } catch (hostedErr) {
        e = hostedErr;
      }
    }

    const fallback = normalizeInventoryImageUrls(args.fallbackImageUrls ?? []);
    if (fallback.length === 0) throw e;
    const hostedFallback = await ensureEbayHostedPhotoUrls(args.accessToken, fallback, {
      forceHost: true,
    });
    const retryUrls = hostedFallback.length > 0 ? hostedFallback : fallback;
    if (urlsMatch(retryUrls, hosted.length > 0 ? hosted : current)) throw e;
    return await args.put(withInventoryProductImageUrls(payload, retryUrls));
  }
}
