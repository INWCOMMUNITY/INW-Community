import { describe, expect, it } from "vitest";
import { buildWixV1AddProductMediaPayload } from "./media";
import {
  shouldPassThroughListingPhotoToWix,
  type WixProductMediaRef,
} from "./media-import";
import {
  buildWixV1CreateBody,
  buildWixV1MediaFromPhotos,
  v1Photos,
  wixProductToSummary,
  wixV1ProductToSummary,
} from "./mapping";
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
      sku: null,
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
      ebayConditionEnum: null,
      aspects: null,
    };
    const body = buildWixV1CreateBody(item) as { product: { media?: unknown; sku?: string } };
    expect(body.product.media).toEqual({
      mainMedia: { image: { url: "https://cdn.example.com/hat.jpg" } },
    });
    expect(body.product.sku).toBe("item-1");
  });

  it("sets sku from the item sku when present", () => {
    const item: SyncStoreItem = {
      id: "item-1",
      sku: "HAT-42",
      title: "Hat",
      description: null,
      photos: [],
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
      ebayConditionEnum: null,
      aspects: null,
    };
    const body = buildWixV1CreateBody(item) as { product: { sku?: string } };
    expect(body.product.sku).toBe("HAT-42");
  });
});

describe("Wix listing photo import quality", () => {
  const fillUrl =
    "https://static.wixstatic.com/media/abc123~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80/abc123~mv2.jpg";
  const originalUrl = "https://static.wixstatic.com/media/abc123~mv2.jpg";

  it("strips /v1/fill transforms from catalog v1 photos", () => {
    expect(
      v1Photos({
        media: { mainMedia: { image: { url: fillUrl } } },
      })
    ).toEqual([originalUrl]);
  });

  it("maps v1 product sku onto the import summary", () => {
    expect(
      wixV1ProductToSummary({
        id: "p1",
        name: "Hat",
        sku: "item-1",
      }).sku
    ).toBe("item-1");
  });

  it("strips /v1/fill transforms from catalog v3 photos", () => {
    const summary = wixProductToSummary({
      id: "p1",
      name: "Hat",
      media: { main: { url: fillUrl } },
    });
    expect(summary.photos).toEqual([originalUrl]);
  });

  it("passes INW Blob URLs through to Wix without restaging", () => {
    expect(
      shouldPassThroughListingPhotoToWix("https://abc.public.blob.vercel-storage.com/hat.jpg")
    ).toBe(true);
    expect(shouldPassThroughListingPhotoToWix("https://i.ebayimg.com/images/g/x/s-l2000.jpg")).toBe(
      false
    );
  });
});
