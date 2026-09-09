import { describe, expect, it } from "vitest";
import { storeItemPatchFromListOnCategoryAssignment } from "./list-on-channel-category-patch";

describe("storeItemPatchFromListOnCategoryAssignment", () => {
  it("replaces leftover clothing specifics when the seller picks a new eBay category", () => {
    const patch = storeItemPatchFromListOnCategoryAssignment(
      {
        storeItemId: "a",
        ebayCategoryId: 261605,
        aspects: [
          { name: "Type", value: "Clock" },
          { name: "Brand", value: "Does Not Apply" },
        ],
      },
      [{ name: "Color", value: "Red" }, { name: "Department", value: "Men" }]
    );
    expect(patch.aspects).toEqual([
      { name: "Type", value: "Clock" },
      { name: "Brand", value: "Does Not Apply" },
    ]);
  });

  it("keeps existing aspects when only Etsy taxonomy is assigned", () => {
    const patch = storeItemPatchFromListOnCategoryAssignment(
      {
        storeItemId: "a",
        etsyTaxonomyId: 1016,
        aspects: [
          { name: "Type", value: "Clock" },
          { name: "Brand", value: "Does Not Apply" },
        ],
      },
      [{ name: "Color", value: "Red" }]
    );
    expect(patch.aspects).toEqual([
      { name: "Color", value: "Red" },
      { name: "Type", value: "Clock" },
      { name: "Brand", value: "Does Not Apply" },
    ]);
  });

  it("does not wipe stored aspects when the popup sends empty rows", () => {
    const patch = storeItemPatchFromListOnCategoryAssignment(
      {
        storeItemId: "a",
        ebayCategoryId: 11450,
        aspects: [{ name: "Type", value: "" }],
      },
      [{ name: "Brand", value: "Unbranded" }]
    );
    expect(patch.ebayCategoryId).toBe(11450);
    expect(patch.aspects).toBeUndefined();
  });
});
