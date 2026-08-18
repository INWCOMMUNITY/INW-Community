import { describe, expect, it } from "vitest";
import {
  extractEbayInventoryAspects,
  inferEbayLinkOrigin,
  isImportedEbayLink,
  isInwCreatedEbayLink,
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
