import { describe, expect, it } from "vitest";
import {
  buildInventoryItemGroupBody,
  buildInventoryItemGroupKey,
  buildVariantInventoryRows,
  buildVariantInventorySkus,
  buildVariantSyncItem,
  mergeGeneratedSkusIntoVariants,
  pinInventoryItemGroupImageUrls,
  applyInventoryItemGroupPhotoPolicy,
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
        imported: true,
      })
    ).toEqual(["inw403004607151v1", "inw403004607151v2"]);
  });

  it("does not switch INW-created listings to migrate SKUs after a listing id exists", () => {
    const created = { ...variantItem, sku: null, id: "itemabc" };
    expect(
      buildVariantInventorySkus(created, {
        parentSku: "itemabc",
        legacyListingId: "403004607151",
        imported: false,
      })
    ).toEqual(["itemabcS", "itemabcM"]);
  });

  it("stamps generated SKUs onto option rows for later reuse", () => {
    const rows = buildVariantInventoryRows(variantItem);
    expect(mergeGeneratedSkusIntoVariants(variantItem.variants, rows)).toEqual([
      {
        name: "Size",
        options: [
          { value: "S", quantity: 1, sku: "SKU1S" },
          { value: "M", quantity: 2, sku: "SKU1M" },
        ],
      },
    ]);
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

  it("omits INW photos from a live group when the seller did not change them", () => {
    const body = buildInventoryItemGroupBody(
      { ...variantItem, photos: ["https://blob.vercel-storage.com/hat.jpg"] },
      ["SKU1S", "SKU1M"]
    );
    expect(
      applyInventoryItemGroupPhotoPolicy(
        body,
        ["https://i.ebayimg.com/images/g/xx/s-l1600.jpg"],
        ["https://blob.vercel-storage.com/hat.jpg"],
        false
      ).imageUrls
    ).toEqual(["https://i.ebayimg.com/images/g/xx/s-l1600.jpg"]);
    expect(
      applyInventoryItemGroupPhotoPolicy(body, [], ["https://blob.vercel-storage.com/hat.jpg"], false)
    ).not.toHaveProperty("imageUrls");
  });

  it("pins live EPS on the group so a resync does not mix INW blob URLs", () => {
    const body = buildInventoryItemGroupBody(
      { ...variantItem, photos: ["https://blob.vercel-storage.com/hat.jpg"] },
      ["SKU1S", "SKU1M"]
    );
    expect(body.imageUrls).toEqual(["https://blob.vercel-storage.com/hat.jpg"]);
    expect(
      pinInventoryItemGroupImageUrls(body, ["https://i.ebayimg.com/images/g/xx/s-l1600.jpg"], [
        "https://blob.vercel-storage.com/hat.jpg",
      ]).imageUrls
    ).toEqual(["https://i.ebayimg.com/images/g/xx/s-l2000.jpg"]);
  });

  it("puts shared Type/Brand on the group so eBay can publish variations", () => {
    const body = buildInventoryItemGroupBody(
      {
        ...variantItem,
        aspects: [
          { name: "Type", value: "T-Shirt" },
          { name: "Brand", value: "Unbranded" },
          { name: "Size", value: "S" },
        ],
      },
      ["SKU1S", "SKU1M"]
    );
    expect(body.aspects).toEqual({ Type: ["T-Shirt"], Brand: ["Unbranded"] });
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
