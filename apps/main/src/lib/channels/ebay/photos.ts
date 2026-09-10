import { isMarketplaceCdnPhotoUrl, selectInboundListingPhotos } from "../photo-urls";

/** Normalize eBay image URLs from Trading/GetItem XML for import preview and storage. */

/** Longest edge eBay's CDN will serve for listing photos (PictureURLSuperSize). */
export const EBAY_IMPORT_PHOTO_LONG_EDGE = 2000;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : null;
}

function allTags(block: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(m[1].trim());
  return out;
}

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/i, "").replace(/\]\]>$/i, "").trim();
}

function isEbayImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "i.ebayimg.com" ||
      host.endsWith(".ebayimg.com") ||
      host === "ebaystatic.com" ||
      host.endsWith(".ebaystatic.com")
    );
  } catch {
    return /ebayimg\.com|ebaystatic\.com/i.test(url);
  }
}

function toHttpsUrl(raw: string): string | null {
  let url = stripCdata(decodeXmlEntities(raw.trim()));
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("http://")) url = `https://${url.slice("http://".length)}`;
  if (!url.startsWith("https://")) return null;
  return url;
}

/** True EPS picture records — `$_N` / `/z/{id}/` / `/00/s/`. Not `/images/g/` CDN copies. */
export function isEbayTrueEpsPictureUrl(url: string): boolean {
  return /\/\$_\d+\./i.test(url) || /\/z\/[^/?#]+/i.test(url) || /\/00\/s\//i.test(url);
}

export function isEbayCdnGalleryPhotoUrl(url: string): boolean {
  return /\/(?:thumbs\/)?images\/g\//i.test(url);
}

/** Etsy/other marketplace CDNs that GetItem sometimes echoes as PictureURL. */
export function isForeignMarketplacePhotoUrl(url: string): boolean {
  try {
    const href = url.startsWith("//") ? `https:${url}` : url;
    const host = new URL(href).hostname.toLowerCase();
    return host === "i.etsystatic.com" || host.endsWith(".etsystatic.com") || host.includes("etsystatic");
  } catch {
    return /etsystatic\.com/i.test(url);
  }
}

/**
 * Prefer eBay EPS URLs. Drop Etsy/blob ExternalPictureURL echoes when any EPS exists
 * so inbound GetItem cannot overwrite INW with sibling-channel CDNs.
 */
export function preferEbayHostedItemPhotos(urls: string[]): string[] {
  const unique: string[] = [];
  for (const url of urls) {
    if (url && !unique.includes(url)) unique.push(url);
  }
  const eps = unique.filter(isEbayImageHost);
  if (eps.length > 0) return eps;
  return unique.filter((url) => !isForeignMarketplacePhotoUrl(url));
}

/** Cron GetItem must not replace INW-hosted photos with marketplace CDN derivatives. */
export function shouldApplyEbayInboundPhotos(args: {
  incoming: string[];
  current: string[];
  force?: boolean;
}): boolean {
  if (args.incoming.length === 0) return false;
  if (args.current.length === 0) return true;
  // Gallery-only GetItem / omitted inventory imageUrls must not delete extra INW photos.
  if (args.incoming.length < args.current.length) return false;
  const selected = selectInboundListingPhotos(args.current, args.incoming);
  const unchanged =
    selected.length === args.current.length && selected.every((url, i) => url === args.current[i]);
  if (unchanged) return false;
  if (args.force) return true;
  return args.current.every(isMarketplaceCdnPhotoUrl);
}

/**
 * Rewrite eBay CDN URLs to the full-size derivative.
 * GetItem / GetMyeBaySelling often return gallery thumbs (`/thumbs/`, s-l64/140/500)
 * or EPS `$_12.JPG` crops — those look fine as a 64px preview and muddy on the listing.
 */
export function upgradeEbayCdnPhotoUrl(url: string): string {
  if (!isEbayImageHost(url)) return url;

  let next = url.replace(/\/thumbs\/images\//i, "/images/");

  const epsHash = next.match(/\/z\/([^/?#]+)\/_?\$?\d+\./i) ?? next.match(/\/z\/([^/?#]+)\//i);
  if (epsHash) {
    return `https://i.ebayimg.com/images/g/${epsHash[1]}/s-l${EBAY_IMPORT_PHOTO_LONG_EDGE}.jpg`;
  }

  next = next.replace(/\/s-l\d+/gi, `/s-l${EBAY_IMPORT_PHOTO_LONG_EDGE}`);
  // leftover EPS crops without a /z/{id}/ hash — $_57 is SuperSize, $_1 is often smaller
  next = next.replace(/\/\$_\d+\.(jpe?g|png|webp|gif)/gi, "/$_57.$1");
  return next.replace(/\?.*$/, "");
}

/** Public https URL suitable for mobile/web Image components and StoreItem.photos. */
export function normalizeEbayPhotoUrl(raw: string): string | null {
  const url = toHttpsUrl(raw);
  if (!url) return null;
  return upgradeEbayCdnPhotoUrl(url);
}

/**
 * Inventory PUT must not convert EPS `$_N` into `/images/g/…/s-l2000` — eBay treats that
 * as mixing self-hosted CDN copies with EPS (#25014). Same-family size bump only.
 */
export function sanitizeEbayPhotoUrlForInventoryPut(raw: string): string | null {
  const url = toHttpsUrl(raw);
  if (!url) return null;
  if (!isEbayImageHost(url)) return url;

  let next = url.replace(/\/thumbs\/images\//i, "/images/");
  if (isEbayTrueEpsPictureUrl(next)) {
    // Echo the live $_N record. Bumping $_12 → $_57 is a different picture URL
    // and eBay treats it as mixing families with the existing EPS gallery (#25014).
    return next.replace(/\?.*$/, "");
  }
  next = next.replace(/\/s-l(\d+)/gi, (_match, size: string) => {
    const n = Number(size);
    return Number.isFinite(n) && n < 500 ? "/s-l1600" : `/s-l${size}`;
  });
  return next.replace(/\?.*$/, "");
}

function collectEbayItemPictureRawUrls(itemXml: string): string[] {
  const raw: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !raw.includes(trimmed)) raw.push(trimmed);
  };
  const pictureDetails = tag(itemXml, "PictureDetails");
  if (pictureDetails) {
    for (const url of allTags(pictureDetails, "PictureURL")) push(url);
    for (const url of allTags(pictureDetails, "ExternalPictureURL")) push(url);
  }
  const extended = tag(itemXml, "ExtendedPictureDetails");
  if (extended) {
    for (const url of allTags(extended, "PictureURL")) push(url);
  }
  for (const url of allTags(itemXml, "PictureURL")) push(url);
  for (const url of allTags(itemXml, "ExternalPictureURL")) push(url);
  if (raw.length === 0) {
    const gallery = tag(pictureDetails ?? itemXml, "GalleryURL");
    if (gallery) push(gallery);
  }
  return raw;
}

function mapEbayItemPhotos(itemXml: string, normalize: (raw: string) => string | null): string[] {
  const urls: string[] = [];
  for (const raw of collectEbayItemPictureRawUrls(itemXml)) {
    const normalized = normalize(raw);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }
  return preferEbayHostedItemPhotos(urls).slice(0, 12);
}

/** Extract photo URLs from a Trading API Item XML fragment. */
export function extractEbayItemPhotos(itemXml: string): string[] {
  return mapEbayItemPhotos(itemXml, normalizeEbayPhotoUrl);
}

/** GetItem pictures for Inventory PUT — HTTPS + same-family size bump, no EPS→CDN rewrite. */
export function extractEbayItemPhotosForInventoryPut(itemXml: string): string[] {
  return mapEbayItemPhotos(itemXml, sanitizeEbayPhotoUrlForInventoryPut);
}

export { tag, allTags, decodeXmlEntities };
