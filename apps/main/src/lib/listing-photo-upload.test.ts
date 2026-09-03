import { describe, expect, it } from "vitest";
import {
  isManagedListingPhotoUrl,
  listingPhotoEffectiveMime,
  listingPhotoExtForMime,
} from "./listing-photo-upload";

describe("listingPhotoEffectiveMime", () => {
  it("accepts standard types", () => {
    expect(listingPhotoEffectiveMime("image/jpeg", "a.jpg")).toBe("image/jpeg");
    expect(listingPhotoEffectiveMime("image/png", "a.png")).toBe("image/png");
    expect(listingPhotoEffectiveMime("image/heic", "a.heic")).toBe("image/heic");
  });

  it("normalizes jpg aliases used by some pickers", () => {
    expect(listingPhotoEffectiveMime("image/jpg", "photo.jpg")).toBe("image/jpeg");
    expect(listingPhotoEffectiveMime("image/pjpeg", "photo.jpg")).toBe("image/jpeg");
  });

  it("infers type from extension when MIME is empty or octet-stream", () => {
    expect(listingPhotoEffectiveMime("", "IMG_1234.HEIC")).toBe("image/heic");
    expect(listingPhotoEffectiveMime("application/octet-stream", "shot.webp")).toBe("image/webp");
  });

  it("rejects non-images even with a photo-looking name", () => {
    expect(listingPhotoEffectiveMime("application/pdf", "photo.jpg")).toBeNull();
    expect(listingPhotoEffectiveMime("", "notes.txt")).toBeNull();
  });
});

describe("listingPhotoExtForMime", () => {
  it("prefers a safe extension from the filename", () => {
    expect(listingPhotoExtForMime("image/jpeg", "x.PNG")).toBe(".png");
  });

  it("falls back to the MIME type", () => {
    expect(listingPhotoExtForMime("image/heic", "photo")).toBe(".heic");
  });
});

describe("isManagedListingPhotoUrl", () => {
  it("allows Vercel Blob hosts", () => {
    expect(isManagedListingPhotoUrl("https://abc.public.blob.vercel-storage.com/listing/1.jpg")).toBe(
      true
    );
    expect(isManagedListingPhotoUrl("https://blob.vercel-storage.com/listing/1.jpg")).toBe(true);
  });

  it("allows local upload paths only", () => {
    expect(isManagedListingPhotoUrl("http://localhost:3000/uploads/business/1.jpg")).toBe(true);
    expect(isManagedListingPhotoUrl("http://localhost:3000/etc/passwd")).toBe(false);
  });

  it("rejects arbitrary remote URLs", () => {
    expect(isManagedListingPhotoUrl("https://example.com/photo.jpg")).toBe(false);
  });
});
