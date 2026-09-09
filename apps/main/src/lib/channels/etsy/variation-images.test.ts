import { describe, expect, it } from "vitest";
import { applyEtsyVariationImagesToMatrix, buildEtsyVariationImageLinks } from "./variation-images";

describe("buildEtsyVariationImageLinks", () => {
  it("maps the image axis value to listing image ids", () => {
    const links = buildEtsyVariationImageLinks({
      products: [
        {
          property_values: [
            { property_id: 200, property_name: "Color", value_ids: [11], values: ["Navy"] },
            { property_id: 100, property_name: "Size", value_ids: [1], values: ["S"] },
          ],
        },
        {
          property_values: [
            { property_id: 200, property_name: "Color", value_ids: [12], values: ["White"] },
            { property_id: 100, property_name: "Size", value_ids: [1], values: ["S"] },
          ],
        },
      ],
      images: [
        { listing_image_id: 501, url_fullxfull: "https://cdn.example/navy.jpg" },
        { listing_image_id: 502, url_fullxfull: "https://cdn.example/white.jpg" },
      ],
      matrix: {
        axes: [
          { name: "Size", values: ["S"] },
          {
            name: "Color",
            values: ["Navy", "White"],
            photosByValue: {
              Navy: ["https://cdn.example/navy.jpg"],
              White: ["https://cdn.example/white.jpg"],
            },
          },
        ],
        imageAxis: "Color",
        skus: [
          { options: { Size: "S", Color: "Navy" }, quantity: 1, photos: ["https://cdn.example/navy.jpg"] },
          { options: { Size: "S", Color: "White" }, quantity: 1, photos: ["https://cdn.example/white.jpg"] },
        ],
      },
    });
    expect(links).toEqual([
      { property_id: 200, value_id: 11, image_id: 501 },
      { property_id: 200, value_id: 12, image_id: 502 },
    ]);
  });
});

describe("applyEtsyVariationImagesToMatrix", () => {
  it("imports variation images onto Color photosByValue and SKU rows", () => {
    const matrix = applyEtsyVariationImagesToMatrix({
      products: [
        {
          property_values: [
            { property_id: 200, property_name: "Color", value_ids: [11], values: ["Navy"] },
            { property_id: 100, property_name: "Size", value_ids: [1], values: ["S"] },
          ],
        },
      ],
      images: [{ listing_image_id: 501, url_fullxfull: "https://cdn.example/navy.jpg" }],
      links: [{ property_id: 200, value_id: 11, image_id: 501 }],
      matrix: {
        axes: [
          { name: "Size", values: ["S"] },
          { name: "Color", values: ["Navy"] },
        ],
        skus: [{ options: { Size: "S", Color: "Navy" }, quantity: 1 }],
      },
    });
    expect(matrix.imageAxis).toBe("Color");
    expect(matrix.axes.find((a) => a.name === "Color")?.photosByValue?.Navy).toEqual([
      "https://cdn.example/navy.jpg",
    ]);
    expect(matrix.skus[0].photos).toEqual(["https://cdn.example/navy.jpg"]);
  });
});
