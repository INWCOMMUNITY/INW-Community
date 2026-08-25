import { describe, expect, it } from "vitest";
import {
  buildInventoryItemGroupKey,
  buildVariantInventorySkus,
  shouldUseInventoryItemGroup,
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
});
