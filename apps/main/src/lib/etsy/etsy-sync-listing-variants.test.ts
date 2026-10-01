import { describe, expect, it } from "vitest";
import {
  localVariantComboKeys,
  mapsMatchLocalCombos,
  remoteProductComboKeys,
} from "./sync-listing-variants";

describe("etsy Size×Color topology helpers", () => {
  it("builds stable local combo keys for Size×Color", () => {
    const keys = localVariantComboKeys([
      { id: "v1", options: { Size: "S", Color: "Red" }, priceCents: 1000, sku: null },
      { id: "v2", options: { Color: "Blue", Size: "M" }, priceCents: 1200, sku: null },
    ]);
    expect(keys).toEqual([
      "color=blue|size=m",
      "color=red|size=s",
    ]);
  });

  it("detects map/local option mismatch", () => {
    const variants = [
      { id: "v1", options: { Size: "S", Color: "Red" }, priceCents: 1000, sku: null },
      { id: "v2", options: { Size: "M", Color: "Blue" }, priceCents: 1200, sku: null },
    ];
    expect(
      mapsMatchLocalCombos({
        maps: [
          {
            storeVariantId: "v1",
            propertyValuesJson: [
              { property_name: "Size", values: ["S"] },
              { property_name: "Color", values: ["Red"] },
            ],
          },
          {
            storeVariantId: "v2",
            propertyValuesJson: [
              { property_name: "Size", values: ["M"] },
              { property_name: "Color", values: ["Blue"] },
            ],
          },
        ],
        variants,
      })
    ).toBe(true);

    expect(
      mapsMatchLocalCombos({
        maps: [
          {
            storeVariantId: "v1",
            propertyValuesJson: [
              { property_name: "Size", values: ["S"] },
              { property_name: "Color", values: ["Green"] },
            ],
          },
        ],
        variants,
      })
    ).toBe(false);
  });

  it("reads remote product combo keys from property_values", () => {
    const keys = remoteProductComboKeys([
      {
        product_id: 1,
        property_values: [
          { property_name: "Size", values: ["S"] },
          { property_name: "Color", values: ["Red"] },
        ],
      },
      {
        product_id: 2,
        property_values: [
          { property_name: "Color", values: ["Blue"] },
          { property_name: "Size", values: ["M"] },
        ],
      },
    ]);
    expect(keys).toEqual(["color=blue|size=m", "color=red|size=s"]);
  });
});
