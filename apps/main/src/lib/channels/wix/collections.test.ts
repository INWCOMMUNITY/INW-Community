import { describe, expect, it } from "vitest";
import {
  buildWixV1OptionsCreateBody,
  isWixCollectionAlreadyExistsError,
  wixV1NeedsOptionStructureRebuild,
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
