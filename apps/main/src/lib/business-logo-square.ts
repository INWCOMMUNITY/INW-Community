import sharp from "sharp";

/** Longest edge before padding; matches typical client-side resize scale. */
const LOGO_MAX_EDGE = 2048;
const LOGO_PAD = { r: 255, g: 255, b: 255, alpha: 1 as const };

/**
 * Fit logo inside a square canvas (letterbox) with white margins so wide/tall
 * marks display fully in circular 1:1 UI (object-cover) without cropping the artwork.
 */
export async function padBusinessLogoToSquareJpeg(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .rotate()
    .resize(LOGO_MAX_EDGE, LOGO_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: LOGO_PAD })
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  if (!w || !h) {
    throw new Error("Invalid image dimensions");
  }

  const side = Math.max(w, h);
  const top = Math.floor((side - h) / 2);
  const bottom = side - h - top;
  const left = Math.floor((side - w) / 2);
  const right = side - w - left;

  return sharp(data)
    .extend({
      top,
      bottom,
      left,
      right,
      background: LOGO_PAD,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
