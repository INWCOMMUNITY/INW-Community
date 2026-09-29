/**
 * Normalize INW listing photo URLs to absolute HTTPS for Shopify Files / product media.
 * Relative paths are resolved against APP_URL / NEXT_PUBLIC_APP_URL when available.
 */
export function toShopifyMediaSourceUrls(photos: string[] | null | undefined): string[] {
  const base =
    process.env.APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "";
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of photos ?? []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let absolute = trimmed;
    if (trimmed.startsWith("//")) {
      absolute = `https:${trimmed}`;
    } else if (trimmed.startsWith("/")) {
      if (!base) continue;
      absolute = `${base.replace(/\/$/, "")}${trimmed}`;
    } else if (!/^https:\/\//i.test(trimmed)) {
      // Reject http:// and non-URL strings — Shopify requires HTTPS originalSource.
      if (/^http:\/\//i.test(trimmed)) {
        absolute = `https://${trimmed.slice("http://".length)}`;
      } else {
        continue;
      }
    }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    out.push(absolute);
  }
  return out;
}

export function shopifyProductSetFileInputs(photos: string[] | null | undefined): Array<{
  originalSource: string;
  contentType: "IMAGE";
  alt: string;
}> {
  return toShopifyMediaSourceUrls(photos).map((url, index) => ({
    originalSource: url,
    contentType: "IMAGE" as const,
    alt: `Photo ${index + 1}`,
  }));
}
