import { describe, expect, it } from "vitest";
import { buildWixV1AddProductMediaPayload } from "./media";
import type { WixProductMediaRef } from "./media-import";
import { buildWixV1CreateBody, buildWixV1MediaFromPhotos } from "./mapping";
import type { SyncStoreItem } from "../types";

describe("buildWixV1MediaFromPhotos", () => {
  it("maps first photo to mainMedia and rest to items", () => {
    const media = buildWixV1MediaFromPhotos([
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
    ]);
    expect(media).toEqual({
      mainMedia: { image: { url: "https://cdn.example.com/a.jpg" } },
      items: [{ image: { url: "https://cdn.example.com/b.jpg" } }],
    });
  });

  it("builds Add Product Media payload with mediaId or url", () => {
    const refs: WixProductMediaRef[] = [
      { mediaId: "abc~mv2.jpg", wixUrl: "https://static.wixstatic.com/media/abc~mv2.jpg" },
      { url: "https://cdn.example.com/b.jpg" },
    ];
    expect(buildWixV1AddProductMediaPayload(refs)).toEqual({
      media: [{ mediaId: "abc~mv2.jpg" }, { url: "https://cdn.example.com/b.jpg" }],
    });
  });

  it("includes media on v1 create body", () => {
    const item: SyncStoreItem = {
      id: "item-1",
      title: "Hat",
      description: null,
      photos: ["https://cdn.example.com/hat.jpg"],
      priceCents: 1000,
      quantity: 2,
      variants: null,
      status: "active",
      condition: "new",
      shippingCostCents: null,
      category: null,
      subcategory: null,
      secondaryCategory: null,
      etsyWhoMade: null,
      etsyWhenMade: null,
      etsyIsSupply: null,
      etsyTaxonomyId: null,
      ebayCategoryId: null,
    };
    const body = buildWixV1CreateBody(item) as { product: { media?: unknown } };
    expect(body.product.media).toEqual({
      mainMedia: { image: { url: "https://cdn.example.com/hat.jpg" } },
    });
  });
});
