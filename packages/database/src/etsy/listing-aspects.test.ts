import { describe, expect, it } from "vitest";
import {
  buildEtsyInboundAspects,
  mergeEtsyInboundAspects,
  normalizeEtsyTags,
} from "./listing-aspects";

describe("buildEtsyInboundAspects", () => {
  it("maps Shop Manager attributes, materials, and dimensions into Item Details", () => {
    const aspects = buildEtsyInboundAspects({
      properties: [
        { property_name: "Occasion", values: ["Birthday"] },
        { property_name: "Room", values: ["Living Room", "Bedroom"] },
        { property_name: "Width", values: ["12"], scale_name: "Inches" },
      ],
      materials: ["Wool", "Cotton"],
      itemWidth: 12,
      itemHeight: 8,
      itemLength: 3,
      itemDimensionsUnit: "in",
    });
    expect(aspects).toEqual(
      expect.arrayContaining([
        { name: "Occasion", value: "Birthday" },
        { name: "Room", value: "Living Room, Bedroom" },
        { name: "Width", value: "12 (Inches)" },
        { name: "Materials", value: "Wool, Cotton" },
        { name: "Height", value: "8 in" },
        { name: "Depth", value: "3 in" },
      ])
    );
    expect(aspects.filter((row) => row.name === "Width")).toHaveLength(1);
  });
});

describe("mergeEtsyInboundAspects", () => {
  it("lets Etsy attribute names replace matching local rows and keeps local-only Brand", () => {
    const merged = mergeEtsyInboundAspects(
      [
        { name: "Brand", value: "Nike" },
        { name: "Occasion", value: "Wedding" },
      ],
      [
        { name: "Occasion", value: "Birthday" },
        { name: "Holiday", value: "Christmas" },
      ]
    );
    expect(merged).toEqual([
      { name: "Occasion", value: "Birthday" },
      { name: "Holiday", value: "Christmas" },
      { name: "Brand", value: "Nike" },
    ]);
  });
});

describe("normalizeEtsyTags", () => {
  it("caps Etsy tags at 13 unique values", () => {
    const tags = normalizeEtsyTags(["a", "A", "b", ...Array.from({ length: 20 }, (_, i) => `t${i}`)]);
    expect(tags[0]).toBe("a");
    expect(tags).toHaveLength(13);
  });
});
