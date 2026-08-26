import { describe, expect, it } from "vitest";
import {
  buildInventoryItemGroupBody,
  buildInventoryItemGroupKey,
  buildVariantInventoryRows,
  buildVariantInventorySkus,
  buildVariantSyncItem,
  shouldUseInventoryItemGroup,
  withVariationAspect,
} from "./inventory-groups";
import type { SyncStoreItem } from "../types";

const variantItem: SyncStoreItem = {
  id: "item-1",
  sku: "SKU-1",
  title: "T-Shirt",
  description: "Desc",
  priceCents: 1000,
  quantity: 3,
  condition: "new",
  photos: [],
  aspects: null,
  variants: [{ name: "Size", options: [{ value: "S", quantity: 1 }, { value: "M", quantity: 2 }] }],
  status: "active",
  category: null,
  subcategory: null,
  secondaryCategory: null,
  shippingCostCents: null,
  etsyWhoMade: null,
  etsyWhenMade: null,
  etsyIsSupply: null,
  etsyTaxonomyId: null,
  ebayCategoryId: null,
  ebayConditionEnum: null,
};

describe("inventory item groups", () => {
  it("detects multi-SKU listings", () => {
    expect(shouldUseInventoryItemGroup(variantItem)).toBe(true);
  });

  it("builds stable group key and alphanumeric variant skus", () => {
    expect(buildInventoryItemGroupKey(variantItem)).toBe("inw-group-SKU-1");
    expect(buildVariantInventorySkus(variantItem)).toEqual(["SKU1S", "SKU1M"]);
  });

  it("strips hyphens from size values so eBay Inventory accepts the SKU", () => {
    const hyphenItem = {
      ...variantItem,
      sku: "HAT-42",
      variants: [
        {
          name: "Size",
          options: [
            { value: "small", quantity: 1 },
            { value: "xl", quantity: 2 },
          ],
        },
      ],
    };
    expect(buildVariantInventorySkus(hyphenItem)).toEqual(["HAT42small", "HAT42xl"]);
    expect(buildVariantInventorySkus(hyphenItem).every((sku) => /^[a-zA-Z0-9]{1,50}$/.test(sku))).toBe(
      true
    );
  });

  it("prefers an existing option SKU and generates the rest", () => {
    const mixed = {
      ...variantItem,
      variants: [
        {
          name: "Size",
          options: [
            { value: "S", quantity: 1, sku: "KEEPME" },
            { value: "M", quantity: 2 },
          ],
        },
      ],
    };
    expect(buildVariantInventorySkus(mixed)).toEqual(["KEEPME", "SKU1M"]);
  });

  it("generates migrate-style SKUs for imported listings without option SKUs", () => {
    const imported = { ...variantItem, sku: null };
    expect(
      buildVariantInventorySkus(imported, {
        parentSku: "inw403004607151",
        legacyListingId: "403004607151",
      })
    ).toEqual(["inw403004607151v1", "inw403004607151v2"]);
  });

  it("includes variesBy so eBay gets variationInformation", () => {
    const body = buildInventoryItemGroupBody(variantItem, ["SKU1S", "SKU1M"]);
    expect(body.variesBy).toEqual({
      specifications: [{ name: "Size", values: ["S", "M"] }],
      aspectsImageVariesBy: ["Size"],
    });
    expect(body.variantSKUs).toEqual(["SKU1S", "SKU1M"]);
    expect(body).not.toHaveProperty("aspects");
  });

  it("pins a single variation aspect on an inventory PUT", () => {
    const row = buildVariantInventoryRows(variantItem)[0]!;
    const body = withVariationAspect(
      { product: { title: "T-Shirt", aspects: { Brand: ["Acme"], Size: ["S", "M"] } } },
      row
    );
    expect((body.product as { aspects: Record<string, string[]> }).aspects).toEqual({
      Brand: ["Acme"],
      Size: ["S"],
    });
    expect(buildVariantSyncItem(variantItem, row).variants).toEqual([
      { name: "Size", options: [{ value: "S", quantity: 1, sku: "SKU1S" }] },
    ]);
  });
});
