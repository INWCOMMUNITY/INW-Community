import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  LISTING_JPEG_QUALITY,
  LISTING_PHOTO_MAX_EDGE,
  optimizeListingPhoto,
} from "./listing-photo-optimize";

describe("optimizeListingPhoto", () => {
  it("caps the longest edge at 3200 and encodes JPEG", async () => {
    const input = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 40, g: 80, b: 120 } },
    })
      .png()
      .toBuffer();

    const out = await optimizeListingPhoto(input);
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(LISTING_PHOTO_MAX_EDGE);
    expect(meta.height).toBe(2400);
    expect(LISTING_JPEG_QUALITY).toBe(92);
  });

  it("does not enlarge a smaller source", async () => {
    const input = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .png()
      .toBuffer();

    const out = await optimizeListingPhoto(input);
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });
});
