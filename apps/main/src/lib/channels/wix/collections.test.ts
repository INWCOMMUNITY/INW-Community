import { describe, expect, it } from "vitest";
import {
  buildWixV1OptionsCreateBody,
  buildWixV1VariantsPriceUpdateBody,
  isWixCollectionAlreadyExistsError,
  wixV1NeedsOptionStructureRebuild,
  wixV1ProductToVariants,
  wixV1VariantPricesMatchItem,
} from "./collections";
import type { SyncStoreItem } from "../types";

const sizeItem: SyncStoreItem = {
  id: "item-1",
  sku: null,
  title: "Tester",
  description: null,
  photos: [],
  priceCents: 1000,
  quantity: 20,
  variants: [
    {
      name: "size",
      options: [
        { value: "small", quantity: 5 },
        { value: "medium", quantity: 5 },
        { value: "large", quantity: 5 },
        { value: "xl", quantity: 5 },
      ],
    },
  ],
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

describe("isWixCollectionAlreadyExistsError", () => {
  it("treats Wix duplicate collection names as success-to-lookup", () => {
    expect(
      isWixCollectionAlreadyExistsError(
        "WixApiError: requirement failed: Collection with name Books, Movies & Music already exists"
      )
    ).toBe(true);
  });
});

describe("Wix Catalog v1 option structure", () => {
  it("sets manageVariants so Wix generates per-option inventory rows", () => {
    const body = buildWixV1OptionsCreateBody(sizeItem) as {
      product: { manageVariants?: boolean; productOptions?: { name: string }[]; variants?: unknown[] };
    };
    expect(body.product.manageVariants).toBe(true);
    expect(body.product.productOptions?.[0]?.name).toBe("size");
    expect(body.product.variants).toHaveLength(4);
  });

  it("does not collapse Size × Color onto the first axis", () => {
    expect(
      buildWixV1OptionsCreateBody({
        ...sizeItem,
        variants: {
          axes: [
            { name: "Size", values: ["S", "M"] },
            { name: "Color", values: ["Navy"] },
          ],
          skus: [],
        },
      })
    ).toBeNull();
  });

  it("imports Size and Color as separate axes instead of M / Red labels", () => {
    const matrix = wixV1ProductToVariants({
      productOptions: [
        { name: "Size", choices: [{ description: "M" }, { description: "L" }] },
        { name: "Color", choices: [{ description: "Red" }, { description: "Blue" }] },
      ],
      variants: [
        {
          id: "1",
          choices: { Size: "M", Color: "Red" },
          stock: { quantity: 3 },
          priceData: { price: 12 },
        },
        {
          id: "2",
          choices: { Size: "L", Color: "Blue" },
          stock: { quantity: 1 },
        },
      ],
    });
    expect(matrix).toMatchObject({
      axes: [
        { name: "Size", values: ["M", "L"] },
        { name: "Color", values: ["Red", "Blue"] },
      ],
    });
    expect(JSON.stringify(matrix)).not.toMatch(/M \/ Red/);
  });

  it("reads nested variant.priceData.price as per-SKU cents", () => {
    const matrix = wixV1ProductToVariants({
      productOptions: [{ name: "Size", choices: [{ description: "S" }, { description: "M" }] }],
      variants: [
        {
          id: "1",
          choices: { Size: "S" },
          stock: { quantity: 2 },
          variant: { priceData: { price: 18.5 } },
        },
        {
          id: "2",
          choices: { Size: "M" },
          stock: { quantity: 1 },
          variant: { priceData: { price: "22.00" } },
        },
      ],
    });
    expect(matrix).toMatchObject({
      skus: [
        { options: { Size: "S" }, quantity: 2, priceCents: 1850 },
        { options: { Size: "M" }, quantity: 1, priceCents: 2200 },
      ],
    });
  });

  it("falls back to top-level priceData when nested price is missing", () => {
    const matrix = wixV1ProductToVariants({
      productOptions: [{ name: "Color", choices: [{ description: "Red" }] }],
      variants: [
        {
          id: "1",
          choices: { Color: "Red" },
          stock: { quantity: 3 },
          priceData: { price: 12 },
        },
      ],
    });
    expect(matrix).toMatchObject({
      skus: [{ options: { Color: "Red" }, quantity: 3, priceCents: 1200 }],
    });
  });

  it("creates untracked stock for made-to-order listings", () => {
    const body = buildWixV1OptionsCreateBody({
      ...sizeItem,
      inventoryTracking: "made_to_order",
    }) as { product: { variants: { stock: { trackInventory?: boolean } }[] } };
    expect(body.product.variants[0].stock.trackInventory).toBe(false);
  });

  it("rebuilds when the only variant is a dummy with empty choices", () => {
    expect(
      wixV1NeedsOptionStructureRebuild({
        id: "p1",
        variants: [{ id: "default", choices: {} }],
      })
    ).toBe(true);
  });

  it("does not rebuild when choice-bearing variants already exist", () => {
    expect(
      wixV1NeedsOptionStructureRebuild({
        id: "p1",
        variants: [
          { id: "v1", choices: { size: "small" } },
          { id: "v2", choices: { size: "medium" } },
        ],
      })
    ).toBe(false);
  });
});

describe("buildWixV1VariantsPriceUpdateBody", () => {
  it("sends Catalog v1 /variants { choices, price } instead of product.variants.priceData", () => {
    const item: SyncStoreItem = {
      ...sizeItem,
      priceCents: 1000,
      variants: {
        axes: [{ name: "Size", values: ["S", "M"] }],
        skus: [
          { options: { Size: "S" }, quantity: 2, priceCents: 1800 },
          { options: { Size: "M" }, quantity: 3, priceCents: 2200 },
        ],
      },
    };
    const body = buildWixV1VariantsPriceUpdateBody(item, {
      variants: [
        { id: "guid-s", choices: { Size: "S" } },
        { id: "guid-m", choices: { Size: "M" } },
      ],
    });
    expect(body).toEqual({
      variants: [
        { choices: { Size: "S" }, price: 18 },
        { choices: { Size: "M" }, price: 22 },
      ],
    });
  });

  it("falls back to variantIds when the Wix row has no choices", () => {
    const item: SyncStoreItem = {
      ...sizeItem,
      priceCents: 1800,
      variants: {
        axes: [{ name: "Size", values: ["S"] }],
        skus: [{ options: { Size: "S" }, quantity: 2, priceCents: 1800 }],
      },
    };
    expect(
      buildWixV1VariantsPriceUpdateBody(item, { variants: [{ id: "guid-s" }] })
    ).toEqual({
      variants: [{ variantIds: ["guid-s"], price: 18 }],
    });
  });
});

describe("wixV1VariantPricesMatchItem", () => {
  const item: SyncStoreItem = {
    ...sizeItem,
    priceCents: 100,
    variants: {
      axes: [{ name: "Size", values: ["S", "M"] }],
      skus: [
        { options: { Size: "S" }, quantity: 2, priceCents: 1800 },
        { options: { Size: "M" }, quantity: 3, priceCents: 2200 },
      ],
    },
  };

  it("rejects a product still sitting at listing $1 on every SKU", () => {
    expect(
      wixV1VariantPricesMatchItem(item, {
        variants: [
          { id: "guid-s", choices: { Size: "S" }, variant: { priceData: { price: 1 } } },
          { id: "guid-m", choices: { Size: "M" }, variant: { priceData: { price: 1 } } },
        ],
      })
    ).toBe(false);
  });

  it("accepts nested variant.priceData that matches INW", () => {
    expect(
      wixV1VariantPricesMatchItem(item, {
        variants: [
          { id: "guid-s", choices: { Size: "S" }, variant: { priceData: { price: 18 } } },
          { id: "guid-m", choices: { Size: "M" }, variant: { priceData: { price: 22 } } },
        ],
      })
    ).toBe(true);
  });
});
