import { describe, expect, it } from "vitest";
import { pickEtsyTaxonomyPropertyForAxis } from "./variants";

describe("pickEtsyTaxonomyPropertyForAxis", () => {
  const props = [
    { property_id: 1, name: "Primary color", possible_values: [{ name: "Blue" }] },
    {
      property_id: 200,
      name: "Size",
      possible_values: [{ name: "Small" }, { name: "Medium" }, { name: "Large" }, { name: "XL" }],
    },
  ];

  it("maps an INW size axis onto Size, not the first taxonomy property", () => {
    const picked = pickEtsyTaxonomyPropertyForAxis(props, "size", ["small", "medium", "large", "xl"]);
    expect(picked?.property_id).toBe(200);
  });

  it("does not fall back to props[0] when nothing matches", () => {
    expect(
      pickEtsyTaxonomyPropertyForAxis(
        [{ property_id: 1, name: "Primary color", possible_values: [{ name: "Blue" }] }],
        "material",
        ["cotton"]
      )
    ).toBeUndefined();
  });
});
