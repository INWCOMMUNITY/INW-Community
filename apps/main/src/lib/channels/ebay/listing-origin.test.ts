import { describe, expect, it } from "vitest";
import {
  extractEbayInventoryAspects,
  inferEbayLinkOrigin,
  isImportedEbayLink,
  isInwCreatedEbayLink,
  resolveEbayInventorySku,
  resolveEbayPushSku,
} from "./listing-origin";

describe("listing-origin", () => {
  it("detects imported eBay link by inw SKU", () => {
    expect(
      isImportedEbayLink({ provider: "ebay", externalListingId: "inw403004607151" })
    ).toBe(true);
  });

  it("detects INW-created link by store item id SKU", () => {
    expect(
      isInwCreatedEbayLink({
        provider: "ebay",
        externalListingId: "cmsz85hpj0001ahwfa2pmvtun",
        storeItemId: "cmsz85hpj0001ahwfa2pmvtun",
      })
    ).toBe(true);
  });

  it("prefers explicit linkOrigin over heuristic", () => {
    expect(
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: "cmsz85hpj0001ahwfa2pmvtun",
        linkOrigin: "import",
      })
    ).toBe(true);
    expect(inferEbayLinkOrigin({ provider: "ebay", externalListingId: "inw123" })).toBe("import");
  });

  it("treats inw SKU as import even when linkOrigin is wrongly inw_create", () => {
    expect(
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: "inw403004607151",
        linkOrigin: "inw_create",
      })
    ).toBe(true);
  });

  it("treats numeric listing id as INW-created when linkOrigin is inw_create", () => {
    expect(
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: "403004607151",
        storeItemId: "cmsz85hpj0001ahwfa2pmvtun",
        linkOrigin: "inw_create",
      })
    ).toBe(false);
    expect(
      isInwCreatedEbayLink({
        provider: "ebay",
        externalListingId: "403004607151",
        storeItemId: "cmsz85hpj0001ahwfa2pmvtun",
        linkOrigin: "inw_create",
      })
    ).toBe(true);
  });

  it("keeps StoreItem id as the Inventory SKU for INW-created listing ids", () => {
    expect(
      resolveEbayPushSku({
        itemId: "cmsz85hpj0001ahwfa2pmvtun",
        itemSku: null,
        externalListingId: "403004607151",
        linkOrigin: "inw_create",
      })
    ).toBe("cmsz85hpj0001ahwfa2pmvtun");
  });

  it("treats numeric legacy Item ID as import", () => {
    expect(
      isImportedEbayLink({
        provider: "ebay",
        externalListingId: "403004607151",
        storeItemId: "cmsz85hpj0001ahwfa2pmvtun",
      })
    ).toBe(true);
    expect(resolveEbayInventorySku("403004607151")).toBe("inw403004607151");
  });

  it("extracts inventory aspects object", () => {
    const aspects = extractEbayInventoryAspects({
      product: {
        aspects: {
          Grade: ["MS 67"],
          "Professional grader": ["NGC"],
        },
      },
    });
    expect(aspects).toEqual({
      Grade: ["MS 67"],
      "Professional grader": ["NGC"],
    });
  });
});
