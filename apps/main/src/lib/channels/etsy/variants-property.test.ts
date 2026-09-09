import { describe, expect, it } from "vitest";
import {
  pickEtsyTaxonomyPropertyForAxis,
  resolveEtsyVariationPropertiesForAxes,
} from "./variants";

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

  it("matches Size via display_name when name differs", () => {
    expect(
      pickEtsyTaxonomyPropertyForAxis(
        [{ property_id: 88, name: "1206", display_name: "Primary size" }],
        "Size",
        ["S", "M"]
      )?.property_id
    ).toBe(88);
  });

  it("does not use a Size attribute that cannot be a variation", () => {
    expect(
      pickEtsyTaxonomyPropertyForAxis(
        [{ property_id: 200, name: "Size", supports_variations: false }],
        "Size",
        ["S"]
      )
    ).toBeUndefined();
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

describe("resolveEtsyVariationPropertiesForAxes", () => {
  it("uses Create-your-own 513 when the category has no Size variation", () => {
    const resolved = resolveEtsyVariationPropertiesForAxes(
      [{ property_id: 1, name: "Primary color", supports_variations: true }],
      [{ name: "Size", values: ["S", "M"] }]
    );
    expect(resolved).toEqual([
      { property_id: 513, property_name: "Size", scale_id: null, custom: true },
    ]);
  });

  it("keeps taxonomy Size and puts a second unmatched axis on 513", () => {
    const resolved = resolveEtsyVariationPropertiesForAxes(
      [
        { property_id: 200, name: "Size", supports_variations: true },
        { property_id: 1, name: "Primary color", supports_variations: true },
      ],
      [
        { name: "Size", values: ["S"] },
        { name: "Scent", values: ["Lavender"] },
      ]
    );
    expect(resolved[0]).toMatchObject({ property_id: 200, custom: false });
    expect(resolved[1]).toMatchObject({ property_id: 513, property_name: "Scent", custom: true });
  });

  it("assigns 513 then 514 when two option types are both custom", () => {
    const resolved = resolveEtsyVariationPropertiesForAxes([], [
      { name: "Size", values: ["S"] },
      { name: "Color", values: ["Navy"] },
    ]);
    expect(resolved.map((r) => r.property_id)).toEqual([513, 514]);
    expect(resolved.every((r) => r.custom)).toBe(true);
  });
});
