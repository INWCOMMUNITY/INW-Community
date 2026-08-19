import { ebayJson } from "./client";
import { EBAY_APIZ_BASE } from "./config";

const IMAGE_RELATED_ERROR = /image|photo|picture|url|media|hosted/i;

export function isEbayImageRelatedInventoryError(message: string | null | undefined): boolean {
  return IMAGE_RELATED_ERROR.test(message ?? "");
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
    const details = await ebayJson<{ imageUrl?: string }>(
      accessToken,
      `${EBAY_APIZ_BASE}/commerce/media/v1_beta/image/${encodeURIComponent(imageId)}`,
      "GET"
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
  photoUrls: string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const url of photoUrls) {
    if (/^https:\/\/i\.ebayimg\.com\//i.test(url)) {
      out.push(url);
      continue;
    }
    const hosted = await uploadEbayImageFromUrl(accessToken, url);
    out.push(hosted ?? url);
  }
  return out;
}
