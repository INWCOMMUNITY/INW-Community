import { describe, expect, it } from "vitest";
import {
  buildEtsyInboundAspects,
  mergeEtsyInboundAspects,
  normalizeEtsyTags,
  stripEtsyPackageDimensionAspects,
} from "./listing-aspects";

describe("buildEtsyInboundAspects", () => {
  it("maps Shop Manager attributes and materials, and leaves package size off Item Details", () => {
    const aspects = buildEtsyInboundAspects({
      properties: [
        { property_name: "Occasion", values: ["Birthday"] },
        { property_name: "Room", values: ["Living Room", "Bedroom"] },
        { property_name: "Width", values: ["12"], scale_name: "Inches" },
      ],
      materials: ["Wool", "Cotton"],
      itemWidth: 6,
      itemHeight: 4,
      itemLength: 8,
      itemDimensionsUnit: "in",
    });
    expect(aspects).toEqual([
      { name: "Occasion", value: "Birthday" },
      { name: "Room", value: "Living Room, Bedroom" },
      { name: "Width", value: "12 (Inches)" },
      { name: "Materials", value: "Wool, Cotton" },
    ]);
  });
});

describe("stripEtsyPackageDimensionAspects", () => {
  it("removes Item Details that echo the Etsy package size", () => {
    const kept = stripEtsyPackageDimensionAspects(
      [
        { name: "WHICH", value: "Random" },
        { name: "Width", value: "6 in" },
        { name: "Height", value: "4 in" },
        { name: "Depth", value: "8 in" },
        { name: "Width", value: "12 (Inches)" },
      ],
      { width: "6 in", height: "4 in", depth: "8 in" }
    );
    expect(kept).toEqual([
      { name: "WHICH", value: "Random" },
      { name: "Width", value: "12 (Inches)" },
    ]);
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
