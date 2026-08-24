import { describe, expect, it } from "vitest";
import type { SyncStoreItem } from "../types";
import { syncEtsyListingInventoryFromInw } from "./variants";

const item = {
  id: "item-1",
  sku: null,
  title: "Navy tachometer",
  description: null,
  photos: [],
  priceCents: 1000,
  quantity: 0,
  variants: null,
  status: "sold_out",
  condition: "used",
  category: null,
  subcategory: null,
  secondaryCategory: null,
  shippingCostCents: null,
  ebayCategoryId: null,
  etsyTaxonomyId: null,
  etsyWhoMade: null,
  etsyWhenMade: null,
  etsyIsSupply: null,
  aspects: [],
  ebayConditionEnum: null,
} satisfies SyncStoreItem;

describe("syncEtsyListingInventoryFromInw qty 0", () => {
  it("throws instead of skipping inventory PUT so callers deactivate", async () => {
    await expect(
      syncEtsyListingInventoryFromInw("token", "4560148898", item, 0, null)
    ).rejects.toThrow(/quantity 0/);
  });
});
