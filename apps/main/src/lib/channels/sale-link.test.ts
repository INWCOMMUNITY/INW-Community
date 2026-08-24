import { describe, expect, it } from "vitest";
import { ebayFulfillmentLineToSale, saleLinkCandidateIds } from "./sale-link";

describe("saleLinkCandidateIds", () => {
  it("expands inw{legacyId} and numeric Item IDs in both directions", () => {
    const ids = saleLinkCandidateIds({
      externalListingId: "inw394295737513",
      sku: "inw394295737513",
      legacyItemId: "394295737513",
    });
    expect(ids).toContain("inw394295737513");
    expect(ids).toContain("394295737513");
  });

  it("keeps INW-created StoreItem ids and live listing ids together", () => {
    const ids = saleLinkCandidateIds({
      externalListingId: "cmsz85hpj0001ahwfa2pmvtun",
      sku: "cmsz85hpj0001ahwfa2pmvtun",
      legacyItemId: "407161593624",
    });
    expect(ids).toContain("cmsz85hpj0001ahwfa2pmvtun");
    expect(ids).toContain("407161593624");
    expect(ids).toContain("inw407161593624");
  });

  it("does not drop a sale that only has a legacy Item ID", () => {
    const ids = saleLinkCandidateIds({
      externalListingId: "394295737513",
      sku: null,
      legacyItemId: "394295737513",
    });
    expect(ids).toContain("394295737513");
    expect(ids).toContain("inw394295737513");
  });
});

describe("ebayFulfillmentLineToSale", () => {
  it("keeps lines that have a legacy Item ID but no SKU", () => {
    const sale = ebayFulfillmentLineToSale("ord-1", {
      lineItemId: "li-1",
      legacyItemId: "394295737513",
      quantity: 2,
    });
    expect(sale).toEqual({
      externalEventId: "order:ord-1:line:li-1",
      externalListingId: "394295737513",
      quantitySold: 2,
      sku: null,
      legacyItemId: "394295737513",
    });
  });

  it("prefers inventory SKU as externalListingId when present", () => {
    const sale = ebayFulfillmentLineToSale("ord-1", {
      lineItemId: "li-1",
      sku: "cmsz85hpj0001ahwfa2pmvtun",
      legacyItemId: "407161593624",
      quantity: 1,
    });
    expect(sale?.externalListingId).toBe("cmsz85hpj0001ahwfa2pmvtun");
    expect(sale?.legacyItemId).toBe("407161593624");
  });

  it("drops lines with neither SKU nor legacy Item ID", () => {
    expect(
      ebayFulfillmentLineToSale("ord-1", { lineItemId: "li-1", quantity: 1 })
    ).toBeNull();
  });
});
