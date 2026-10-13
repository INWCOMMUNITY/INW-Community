import { describe, expect, it } from "vitest";
import { classifyShopifyProductMetafields } from "./buyer-metafields";

describe("Shopify metafields to INW custom options", () => {
  it("maps Etsy equivalents: text, choice list, and one file", () => {
    const result = classifyShopifyProductMetafields([
      { namespace: "custom", key: "note", type: "single_line_text_field", definition: { name: "Specifics" } },
      { namespace: "custom", key: "story", type: "multi_line_text_field", definition: { name: "Story" } },
      {
        namespace: "custom",
        key: "font",
        type: "single_line_text_field",
        definition: {
          name: "Font Choice",
          validations: [{ name: "choices", value: JSON.stringify(["Romans", "Calibri"]) }],
        },
      },
      {
        namespace: "custom",
        key: "photo",
        type: "file_reference",
        definition: {
          name: "Pet Photo",
          validations: [{ name: "file_type_options", value: JSON.stringify(["Image"]) }],
        },
      },
    ]);
    expect(result.incompatible).toEqual([]);
    expect(result.buyerFields.map((field) => field.kind)).toEqual(["TEXT", "TEXT", "DROPDOWN", "FILE"]);
    expect(result.buyerFields[2]?.options.map((option) => option.label)).toEqual(["Romans", "Calibri"]);
  });

  it("skips the INW export id and flags types Etsy cannot store", () => {
    const result = classifyShopifyProductMetafields([
      { namespace: "$app", key: "listing_export_id", type: "id", definition: { name: "Listing export" } },
      { namespace: "custom", key: "count", type: "number_integer", definition: { name: "Pack count" } },
      { namespace: "custom", key: "care", type: "metaobject_reference", definition: { name: "Care guide" } },
      {
        namespace: "custom",
        key: "clip",
        type: "file_reference",
        definition: {
          name: "Demo video",
          validations: [{ name: "file_type_options", value: JSON.stringify(["Video"]) }],
        },
      },
      {
        namespace: "custom",
        key: "colors",
        type: "list.single_line_text_field",
        definition: {
          name: "Colors",
          validations: [{ name: "choices", value: JSON.stringify(["Red", "Blue"]) }],
        },
      },
    ]);
    expect(result.buyerFields).toEqual([]);
    expect(result.incompatible.map((row) => row.name)).toEqual([
      "Pack count",
      "Care guide",
      "Demo video",
      "Colors",
    ]);
    expect(result.incompatible[0]?.typeLabel).toBe("Integer");
    expect(result.incompatible[1]?.typeLabel).toBe("Metaobject");
  });

  it("leaves a choice list off when a label is too long for Etsy", () => {
    const result = classifyShopifyProductMetafields([
      {
        namespace: "custom",
        key: "font",
        type: "single_line_text_field",
        definition: {
          name: "Font Choice",
          validations: [{ name: "choices", value: JSON.stringify(["This label is way too long"]) }],
        },
      },
    ]);
    expect(result.buyerFields).toEqual([]);
    expect(result.incompatible).toHaveLength(1);
  });
});
