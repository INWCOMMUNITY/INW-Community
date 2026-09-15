import { describe, expect, it } from "vitest";
import {
  ebaySkuMapHasPins,
  ebaySkuMapProbeCandidates,
  mappedEbayInventorySku,
  mergeEbaySkuMap,
  parseEbaySkuMap,
} from "./sku-map";

describe("ebaySkuMap", () => {
  it("drops hyphen parent pins and keeps alphanumeric Inventory SKUs", () => {
    expect(
      parseEbaySkuMap({
        parent: "cmt7vumcl000dxjujvgwe8dob-Purple",
        variations: {
          HATS: "407212336299abc",
          bad: "HAT-42",
        },
      })
    ).toEqual({
      parent: null,
      variations: { HATS: "407212336299abc" },
    });
  });

  it("resolves a join key through the variation map before the parent pin", () => {
    const map = parseEbaySkuMap({
      parent: "inw404516850572",
      variations: { HATS: "407212336299abc" },
    });
    expect(mappedEbayInventorySku(map, "HATS")).toBe("407212336299abc");
    expect(mappedEbayInventorySku(map, "inw404516850572")).toBe("inw404516850572");
    expect(mappedEbayInventorySku(map, "cmt7vumcl000dxjujvgwe8dob-Purple")).toBe("inw404516850572");
    expect(ebaySkuMapHasPins(map)).toBe(true);
  });

  it("probe candidates never include hyphen parents", () => {
    expect(
      ebaySkuMapProbeCandidates({
        map: { parent: "inw404516850572", variations: { HATS: "407212336299abc" } },
        joinKey: "HATS",
        extra: ["HAT-42", "cmt7vumcl000dxjujvgwe8dob-Purple"],
      })
    ).toEqual(["407212336299abc", "HATS", "inw404516850572"]);
  });

  it("merges newly discovered variation pins", () => {
    const merged = mergeEbaySkuMap({ parent: "inw1", variations: { A: "pinA" } }, {
      parent: "inw1",
      variations: { B: "pinB", bad: "x-y" },
    });
    expect(merged).toEqual({ parent: "inw1", variations: { A: "pinA", B: "pinB" } });
  });
});
