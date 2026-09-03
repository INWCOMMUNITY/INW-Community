import sharp from "sharp";
import { LISTING_JPEG_QUALITY, LISTING_PHOTO_MAX_EDGE } from "./listing-photo-upload";

export { LISTING_JPEG_QUALITY, LISTING_PHOTO_MAX_EDGE };

export async function optimizeListingPhoto(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(LISTING_PHOTO_MAX_EDGE, LISTING_PHOTO_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: LISTING_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** Download a public listing photo for server-side processing (channel sync). */
export async function fetchListingPhotoSource(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": "INW-Community/1.0 (listing-sync)" },
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Photo fetch failed (${res.status})`);
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct && !ct.includes("image") && !ct.includes("octet-stream")) {
    throw new Error(`Photo URL is not an image (${ct})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) {
    throw new Error("Photo download was empty");
  }
  return buf;
}
