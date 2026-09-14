import { describe, expect, it } from "vitest";
import { applySkuRepair, parseSkuRepairRequest, suggestedSkuRepairs } from "./sku-repair";

describe("parseSkuRepairRequest", () => {
  it("requires storeItemId and a known kind", () => {
    expect(parseSkuRepairRequest({})).toEqual({ error: "storeItemId is required." });
    expect(parseSkuRepairRequest({ storeItemId: "item-1", kind: "explode" })).toEqual({
      error: "Unknown repair action.",
    });
  });

  it("accepts method-2 actions", () => {
    expect(parseSkuRepairRequest({ storeItemId: "item-1", kind: "adopt_pin" })).toEqual({
      storeItemId: "item-1",
      kind: "adopt_pin",
      sku: undefined,
      comboKey: undefined,
      provider: undefined,
    });
    expect(
      parseSkuRepairRequest({
        storeItemId: "item-1",
        kind: "rewrite_remote",
        provider: "wix",
      })
    ).toMatchObject({ kind: "rewrite_remote", provider: "wix" });
  });
});

describe("applySkuRepair guards", () => {
  it("does not rename live eBay Inventory SKUs", async () => {
    await expect(
      applySkuRepair("member-1", { storeItemId: "item-1", kind: "rewrite_remote", provider: "ebay" })
    ).resolves.toEqual({
      ok: false,
      error: "Do not rename live eBay Inventory SKUs. Adopt the pin onto INW instead.",
    });
  });

  it("does not PUT Shopify until it is connected", async () => {
    await expect(
      applySkuRepair("member-1", { storeItemId: "item-1", kind: "rewrite_remote", provider: "shopify" })
    ).resolves.toEqual({
      ok: false,
      error: "Shopify SKU rewrite waits until Shopify is connected.",
    });
  });
});

describe("suggestedSkuRepairs", () => {
  it("adopts a live eBay pin onto a blank INW unit", () => {
    expect(
      suggestedSkuRepairs({
        kind: "parent",
        catalogFindings: ["missing", "uses_item_id"],
        inwSku: null,
        channels: [{ provider: "ebay", remoteSku: "inw404516850572", class: "missing_inw" }],
      }).map((a) => a.kind)
    ).toEqual(["adopt_pin"]);
  });

  it("clears leftover parent and copies combo SKUs onto Wix", () => {
    const parent = suggestedSkuRepairs({
      kind: "parent",
      catalogFindings: ["parent_is_variant_leftover", "has_hyphen_or_punct"],
      inwSku: "cmt7vumcl000dxjujvgwe8dob-Purple",
      channels: [],
    });
    expect(parent.map((a) => a.kind)).toEqual(["clear_leftover_parent"]);
    expect(
      suggestedSkuRepairs({
        kind: "combo",
        catalogFindings: [],
        inwSku: "cmt7vumcl000dxjujvgwe8dob1505dff",
        channels: [
          { provider: "ebay", remoteSku: "cmt7vumcl000dxjujvgwe8dob1505dff", class: "exact" },
          { provider: "wix", remoteSku: "cmt7vumcl000dxjujvgwe8dob-Purple", class: "duplicate_remote" },
        ],
      }).map((a) => a)
    ).toEqual([{ kind: "rewrite_remote", provider: "wix", label: "Copy SKU to Wix" }]);
  });

  it("offers assign when the unit is unpublished and blank", () => {
    expect(
      suggestedSkuRepairs({
        kind: "parent",
        catalogFindings: ["missing"],
        inwSku: null,
        channels: [],
      }).map((a) => a.kind)
    ).toEqual(["assign_canonical"]);
  });
});
