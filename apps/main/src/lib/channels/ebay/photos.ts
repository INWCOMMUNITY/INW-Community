/** Normalize eBay image URLs from Trading/GetItem XML for import preview and storage. */

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

/** Public https URL suitable for mobile/web Image components and StoreItem.photos. */
export function normalizeEbayPhotoUrl(raw: string): string | null {
  let url = decodeXmlEntities(raw.trim());
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("http://")) url = `https://${url.slice("http://".length)}`;
  if (!url.startsWith("https://")) return null;

  // eBay CDN uses /s-lNNN/ for resized versions.
  // s-l2000 is the highest resolution eBay serves (original quality).
  // Upgrade any resize suffix to s-l2000 to get the full original resolution.
  if (/\/s-l\d+\./i.test(url)) {
    url = url.replace(/\/s-l\d+\./i, "/s-l2000.");
  }

  return url;
}

/** Extract photo URLs from a Trading API Item XML fragment. */
export function extractEbayItemPhotos(itemXml: string): string[] {
  const urls: string[] = [];
  const push = (raw: string) => {
    const normalized = normalizeEbayPhotoUrl(raw);
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  };

  for (const url of allTags(itemXml, "PictureURL")) push(url);
  for (const url of allTags(itemXml, "ExternalPictureURL")) push(url);

  if (urls.length === 0) {
    const pictureDetails = tag(itemXml, "PictureDetails") ?? itemXml;
    const gallery = tag(pictureDetails, "GalleryURL");
    if (gallery) push(gallery);
  }

  return urls.slice(0, 12);
}

export { tag, allTags, decodeXmlEntities };
