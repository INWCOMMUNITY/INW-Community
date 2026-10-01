import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/listing-photo-optimize", () => ({
  fetchListingPhotoSource: vi.fn(async () => Buffer.from("raw")),
  optimizeListingPhoto: vi.fn(async () => Buffer.from("jpeg-bytes")),
}));

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

import { etsyConnectionRequest } from "./connection-request";
import { uploadEtsyListingPhotosFromUrls } from "./listing-images";

describe("uploadEtsyListingPhotosFromUrls", () => {
  beforeEach(() => {
    vi.mocked(etsyConnectionRequest).mockReset();
  });

  it("uploads every INW photo with overwrite=true and drops etsy CDN urls", async () => {
    vi.mocked(etsyConnectionRequest)
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 201,
        data: {},
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 201,
        data: {},
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: { results: [{ listing_image_id: 9, rank: 3 }] },
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 204,
        data: {},
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      });

    const result = await uploadEtsyListingPhotosFromUrls({
      connectionId: "conn-1",
      memberId: "m1",
      shopId: "99",
      etsyListingId: "555",
      photos: [
        "https://public.blob.vercel-storage.com/a.jpg",
        "https://i.etsystatic.com/skip-me.jpg",
        "https://public.blob.vercel-storage.com/b.jpg",
      ],
    });

    expect(result).toEqual({ uploaded: 2, attempted: 2, lastError: null });
    const posts = vi
      .mocked(etsyConnectionRequest)
      .mock.calls.filter((call) => call[0]?.method === "POST");
    expect(posts).toHaveLength(2);
    for (const call of posts) {
      const body = call[0]?.body as FormData;
      expect(body.get("overwrite")).toBe("true");
    }
    expect(posts[0]?.[0]?.body && (posts[0][0].body as FormData).get("rank")).toBe("1");
    expect(posts[1]?.[0]?.body && (posts[1][0].body as FormData).get("rank")).toBe("2");
    const deletes = vi
      .mocked(etsyConnectionRequest)
      .mock.calls.filter((call) => call[0]?.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0]?.[0]?.path)).toContain("/images/9");
  });
});
