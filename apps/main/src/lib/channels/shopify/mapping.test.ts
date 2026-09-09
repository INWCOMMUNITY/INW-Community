import { describe, expect, it } from "vitest";
import {
  buildShopifyCreateBody,
  buildShopifyUpdateBody,
  pickShopifyCategoryLabel,
  quantityForShopifyRemoteVariant,
  shopifyProductToVariants,
  shopifyUpdateShouldReplaceImages,
} from "./mapping";
import type { SyncStoreItem } from "../types";

const baseItem: SyncStoreItem = {
  id: "item-1",
  sku: "TEE",
  title: "Tee",
  description: null,
  photos: [],
  priceCents: 2000,
  quantity: 5,
  variants: {
    axes: [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Navy"] },
    ],
    skus: [
      { options: { Size: "S", Color: "Navy" }, quantity: 2, priceCents: 2200, sku: "TEE-S-NVY" },
      { options: { Size: "M", Color: "Navy" }, quantity: 3, sku: "TEE-M-NVY" },
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

describe("shopifyProductToVariants", () => {
  it("imports combo qty, price, and SKU instead of aggregating per option value", () => {
    const matrix = shopifyProductToVariants({
      options: [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Navy"] },
      ],
      variants: [
        { option1: "S", option2: "Navy", inventory_quantity: 2, price: "22.00", sku: "TEE-S-NVY" },
        { option1: "M", option2: "Navy", inventory_quantity: 3, price: "20.00", sku: "TEE-M-NVY" },
      ],
    });
    expect(matrix?.skus).toEqual([
        { options: { Size: "S", Color: "Navy" }, quantity: 2, priceCents: 2200, sku: "TEE-S-NVY" },
        { options: { Size: "M", Color: "Navy" }, quantity: 3, priceCents: 2000, sku: "TEE-M-NVY" },
      ]);
    expect(matrix?.axes[0]).toEqual({ name: "Size", values: ["S", "M"] });
  });

  it("imports variant photos onto the image axis", () => {
    const matrix = shopifyProductToVariants({
      options: [
        { name: "Size", values: ["S"] },
        { name: "Color", values: ["Navy"] },
      ],
      images: [{ id: 9, src: "https://cdn.example/navy.jpg" }],
      variants: [
        {
          option1: "S",
          option2: "Navy",
          inventory_quantity: 1,
          price: "20.00",
          image_id: 9,
        },
      ],
    });
    expect(matrix?.imageAxis).toBe("Color");
    expect(matrix?.skus[0].photos).toEqual(["https://cdn.example/navy.jpg"]);
  });
});

describe("buildShopifyCreateBody", () => {
  it("pushes cartesian SKUs with combo qty and price", () => {
    const body = buildShopifyCreateBody(baseItem) as {
      product: { variants: { option1?: string; option2?: string; inventory_quantity: number; price: string; sku: string; inventory_management: string | null }[] };
    };
    expect(body.product.variants).toHaveLength(2);
    expect(body.product.variants[0]).toMatchObject({
      option1: "S",
      option2: "Navy",
      inventory_quantity: 2,
      price: "22.00",
      sku: "TEE-S-NVY",
      inventory_management: "shopify",
    });
  });

  it("sets inventory_management null for made-to-order", () => {
    const body = buildShopifyCreateBody({
      ...baseItem,
      inventoryTracking: "made_to_order",
    }) as { product: { variants: { inventory_management: string | null; inventory_quantity: number }[] } };
    expect(body.product.variants[0].inventory_management).toBeNull();
    expect(body.product.variants[0].inventory_quantity).toBe(999);
  });

  it("sets mapped product_type instead of the raw INW label", () => {
    const body = buildShopifyCreateBody({
      ...baseItem,
      category: "Video Games & Consoles",
      subcategory: "Games (physical)",
    }) as { product: { product_type?: string } };
    expect(body.product.product_type).toBe("Video Games");
  });

  it("does not invent hyphenated SKUs when combo rows have none", () => {
    const body = buildShopifyCreateBody({
      ...baseItem,
      sku: null,
      variants: {
        axes: [{ name: "Color", values: ["Purple"] }],
        skus: [{ options: { Color: "Purple" }, quantity: 2 }],
      },
    }) as { product: { variants: { sku: string }[] } };
    expect(body.product.variants[0].sku).toBe("item1Purple");
    expect(body.product.variants[0].sku).not.toContain("-");
  });
});

describe("shopifyUpdateShouldReplaceImages", () => {
  it("does not replace Shopify images with eBay CDN URLs", () => {
    expect(shopifyUpdateShouldReplaceImages(["https://i.ebayimg.com/images/g/xx/s-l2000.jpg"])).toBe(
      false
    );
    expect(
      shopifyUpdateShouldReplaceImages(["https://abc.public.blob.vercel-storage.com/hat.jpg"])
    ).toBe(true);
    expect(shopifyUpdateShouldReplaceImages(["https://cdn.shopify.com/s/files/1/a.jpg"])).toBe(false);
  });

  it("omits images from an update body when INW only has eBay CDNs", () => {
    const body = buildShopifyUpdateBody(
      {
        ...baseItem,
        variants: null,
        photos: ["https://i.ebayimg.com/images/g/xx/s-l2000.jpg"],
      },
      "123"
    ) as { product: { images?: { src: string }[] } };
    expect(body.product.images).toBeUndefined();
  });

  it("omits images from an update body when INW only has Shopify CDNs", () => {
    const body = buildShopifyUpdateBody(
      {
        ...baseItem,
        variants: null,
        photos: ["https://cdn.shopify.com/s/files/1/clock.jpg"],
      },
      "123"
    ) as { product: { images?: { src: string }[] } };
    expect(body.product.images).toBeUndefined();
  });
});

describe("pickShopifyCategoryLabel", () => {
  it("uses product_type when it is a real category", () => {
    expect(
      pickShopifyCategoryLabel({ product_type: "Apparel", tags: "sale, featured" }, "Frontpage")
    ).toEqual({ category: "Apparel", subcategory: null });
  });

  it("falls back to collection then tag when product_type is empty", () => {
    expect(
      pickShopifyCategoryLabel({ product_type: "", tags: "Video Game" }, "New Arrivals")
    ).toEqual({ category: "Video Game", subcategory: null });
    expect(
      pickShopifyCategoryLabel({ product_type: null, tags: "sale" }, "Video Games")
    ).toEqual({ category: "Video Games", subcategory: null });
  });

  it("prefers Shopify Admin taxonomy over product_type and collections", () => {
    expect(
      pickShopifyCategoryLabel(
        { product_type: "Merch", tags: "sale" },
        "Summer Drop",
        "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts"
      )
    ).toEqual({
      category: "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts",
      subcategory: "T-Shirts",
    });
  });
});

describe("quantityForShopifyRemoteVariant", () => {
  it("matches combo qty instead of aggregating Size or Color", () => {
    const item = {
      quantity: 99,
      inventoryTracking: "tracked",
      variants: baseItem.variants,
    };
    const product = {
      options: [
        { name: "Size", values: ["S", "M"] },
        { name: "Color", values: ["Navy"] },
      ],
    };
    expect(quantityForShopifyRemoteVariant(item, product, { option1: "S", option2: "Navy" })).toBe(2);
    expect(quantityForShopifyRemoteVariant(item, product, { option1: "M", option2: "Navy" })).toBe(3);
  });
});
