import { describe, expect, it } from "vitest";
import { buildWixV1AddProductMediaPayload } from "./media";
import {
  shouldPassThroughListingPhotoToWix,
  shouldReplaceWixProductMedia,
  shouldReplaceWixProductMediaOnUpdate,
  type WixProductMediaRef,
} from "./media-import";
import {
  buildWixV1CreateBody,
  buildWixV1MediaFromPhotos,
  buildWixV1UpdateBody,
  v1Photos,
  wixProductToSummary,
  wixV1ProductToSummary,
  wixV3ProductToVariants,
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

  it("does not treat fallback qty 1 as known stock", () => {
    const summary = wixV1ProductToSummary({
      id: "p1",
      name: "Hat",
      variants: [{ id: "default", choices: {} }],
    });
    expect(summary.quantityKnown).toBe(false);
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
    expect(
      shouldPassThroughListingPhotoToWix(
        "https://static.wixstatic.com/media/2bdd49_e8516210f633401a835101e736618657~mv2.jpg"
      )
    ).toBe(true);
  });

  it("does not replace Wix media when every photo is already on wixstatic", () => {
    expect(
      shouldReplaceWixProductMedia([
        "https://static.wixstatic.com/media/aaa~mv2.jpg",
        "https://static.wixstatic.com/media/bbb~mv2.jpg",
      ])
    ).toBe(false);
    expect(
      shouldReplaceWixProductMedia(["https://abc.public.blob.vercel-storage.com/hat.jpg"])
    ).toBe(true);
    expect(shouldReplaceWixProductMedia(["https://cdn.shopify.com/s/files/1/hat.jpg"])).toBe(false);
  });

  it("does not replace Wix media on update unless INW photos changed", () => {
    const inw = ["https://abc.public.blob.vercel-storage.com/hat.jpg"];
    expect(shouldReplaceWixProductMediaOnUpdate(inw, inw)).toBe(false);
    expect(shouldReplaceWixProductMediaOnUpdate(inw, null)).toBe(false);
    expect(
      shouldReplaceWixProductMediaOnUpdate(inw, [
        "https://abc.public.blob.vercel-storage.com/old.jpg",
      ])
    ).toBe(true);
  });

  it("does not replace Wix media with eBay CDN URLs after an inbound overwrite", () => {
    expect(
      shouldReplaceWixProductMediaOnUpdate(
        ["https://i.ebayimg.com/images/g/one/s-l2000.jpg"],
        ["https://abc.public.blob.vercel-storage.com/hat.jpg"]
      )
    ).toBe(false);
  });
});

describe("buildWixV1UpdateBody", () => {
  const optionItem: SyncStoreItem = {
    id: "item-1",
    sku: "HAT",
    title: "Hat",
    description: null,
    photos: [],
    priceCents: 1000,
    quantity: 5,
    variants: {
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 2, priceCents: 1800 },
        { options: { Size: "M" }, quantity: 3, priceCents: 2200 },
      ],
    },
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

  it("does not stamp listing price onto every option variant", () => {
    const body = buildWixV1UpdateBody(optionItem, {
      variants: [
        { id: "v-s", choices: { Size: "S" } },
        { id: "v-m", choices: { Size: "M" } },
      ],
    }) as { product: { variants: Record<string, unknown>[] } };
    expect(body.product.variants).toEqual([{ id: "v-s" }, { id: "v-m" }]);
    expect(body.product.variants[0].priceData).toBeUndefined();
    expect(body.product.variants[0].stock).toBeUndefined();
  });

  it("still sends stock and listing price for a simple product", () => {
    const body = buildWixV1UpdateBody(
      { ...optionItem, variants: null },
      { variants: [{ id: "default" }] }
    ) as { product: { variants: { id: string; stock?: unknown; priceData?: { price: number } }[] } };
    expect(body.product.variants[0]).toMatchObject({
      id: "default",
      priceData: { price: 10 },
    });
    expect(body.product.variants[0].stock).toBeDefined();
  });
});

describe("wixV3ProductToVariants", () => {
  it("maps actualPrice.amount onto SKU rows", () => {
    const matrix = wixV3ProductToVariants({
      id: "p1",
      name: "Hat",
      variantsInfo: {
        variants: [
          {
            sku: "HAT-S",
            price: { actualPrice: { amount: "18.50" } },
            choices: [{ optionChoiceNames: { optionName: "Size", choiceName: "S" } }],
          },
          {
            sku: "HAT-M",
            price: { actualPrice: { amount: "22.00" } },
            optionChoices: [{ optionName: "Size", choiceName: "M" }],
          },
        ],
      },
    });
    expect(matrix).toMatchObject({
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 0, priceCents: 1850, sku: "HAT-S" },
        { options: { Size: "M" }, quantity: 0, priceCents: 2200, sku: "HAT-M" },
      ],
    });
  });
});
