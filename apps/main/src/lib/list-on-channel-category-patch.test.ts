import { describe, expect, it } from "vitest";
import { storeItemPatchFromListOnCategoryAssignment } from "./list-on-channel-category-patch";

describe("storeItemPatchFromListOnCategoryAssignment", () => {
  it("keeps existing aspects and maps no-brand to Unbranded", () => {
    const patch = storeItemPatchFromListOnCategoryAssignment(
      {
        storeItemId: "a",
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
      { name: "Brand", value: "Unbranded" },
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
