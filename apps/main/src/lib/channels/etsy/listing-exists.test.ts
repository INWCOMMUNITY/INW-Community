import { describe, expect, it } from "vitest";
import {
  etsyLinkedListingNeedsHydrate,
  etsyListingIsNotActive,
  etsyListingStateMeansGone,
  etsyHydrateBelongsInActiveCatalog,
  etsyInboundHydratePriority,
  etsyRemoteQuantityIsKnown,
  etsyShopListQuantityIsTrusted,
  shouldSkipEtsyUntrustedZeroPush,
} from "./listing-exists";

describe("etsyListingStateMeansGone", () => {
  it("treats removed/expired/sold_out as gone", () => {
    expect(etsyListingStateMeansGone("removed")).toBe(true);
    expect(etsyListingStateMeansGone("expired")).toBe(true);
    expect(etsyListingStateMeansGone("sold_out")).toBe(true);
  });

  it("keeps active, draft, and inactive listings", () => {
    expect(etsyListingStateMeansGone("active")).toBe(false);
    expect(etsyListingStateMeansGone("draft")).toBe(false);
    expect(etsyListingStateMeansGone("inactive")).toBe(false);
    expect(etsyListingStateMeansGone(null)).toBe(false);
  });
});

describe("etsyLinkedListingNeedsHydrate", () => {
  it("hydrates listings missing from the active shop list", () => {
    expect(etsyLinkedListingNeedsHydrate(undefined)).toBe(true);
  });

  it("hydrates list rows that have no last_modified timestamp", () => {
    expect(etsyLinkedListingNeedsHydrate({ remoteUpdatedAt: null })).toBe(true);
    expect(etsyLinkedListingNeedsHydrate({ remoteUpdatedAt: undefined })).toBe(true);
  });

  it("skips matching list rows that already have last_modified", () => {
    expect(
      etsyLinkedListingNeedsHydrate(
        {
          remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"),
          title: "Clock",
          quantity: 3,
        },
        { title: "Clock", quantity: 3 }
      )
    ).toBe(false);
  });

  it("hydrates when the shop list title or qty disagrees with INW", () => {
    const stamped = { remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"), title: "Old", quantity: 0 };
    expect(etsyLinkedListingNeedsHydrate(stamped, { title: "New Etsy title", quantity: 0 })).toBe(
      true
    );
    expect(etsyLinkedListingNeedsHydrate(stamped, { title: "Old", quantity: 4 })).toBe(true);
  });

  it("hydrates matching title/qty 0 so offering stock can recover a false INW zero", () => {
    expect(
      etsyLinkedListingNeedsHydrate(
        {
          remoteUpdatedAt: new Date("2026-09-08T17:40:26.798Z"),
          title: "Clock",
          quantity: 0,
        },
        { title: "Clock", quantity: 0 }
      )
    ).toBe(true);
  });

  it("hydrates when last_modified is newer than the INW baseline even if shop-list qty matches", () => {
    expect(
      etsyLinkedListingNeedsHydrate(
        {
          remoteUpdatedAt: new Date("2026-09-09T18:40:00.000Z"),
          title: "Clock",
          quantity: 3,
        },
        {
          title: "Clock",
          quantity: 3,
          updatedAt: new Date("2026-09-09T12:00:00.000Z"),
          baselineAt: new Date("2026-09-09T12:00:00.000Z"),
        }
      )
    ).toBe(true);
  });
});

describe("etsyShopListQuantityIsTrusted", () => {
  it("does not trust shop-list qty 0 until inventory is enriched", () => {
    expect(etsyShopListQuantityIsTrusted({ quantity: 0, inventoryEnriched: false })).toBe(false);
    expect(etsyShopListQuantityIsTrusted({ quantity: 0, inventoryEnriched: true })).toBe(true);
    expect(etsyShopListQuantityIsTrusted({ quantity: 4, inventoryEnriched: false })).toBe(true);
  });
});

describe("etsyRemoteQuantityIsKnown", () => {
  it("does not treat listing.quantity 0 as known without inventory enrich", () => {
    expect(
      etsyRemoteQuantityIsKnown({ quantity: 0, quantityKnown: true, inventoryEnriched: false })
    ).toBe(false);
    expect(
      etsyRemoteQuantityIsKnown({ quantity: 0, quantityKnown: true, inventoryEnriched: true })
    ).toBe(true);
    expect(
      etsyRemoteQuantityIsKnown({ quantity: 4, quantityKnown: true, inventoryEnriched: false })
    ).toBe(true);
  });
});

describe("shouldSkipEtsyUntrustedZeroPush", () => {
  it("blocks pushing INW zero when Etsy shop-list qty is untrusted", () => {
    expect(shouldSkipEtsyUntrustedZeroPush({ inwQuantity: 0, remoteQtyKnown: false })).toBe(true);
    expect(shouldSkipEtsyUntrustedZeroPush({ inwQuantity: 0, remoteQtyKnown: true })).toBe(false);
    expect(shouldSkipEtsyUntrustedZeroPush({ inwQuantity: 4, remoteQtyKnown: false })).toBe(false);
  });
});

describe("etsyInboundHydratePriority", () => {
  it("hydrates missing rows and false shop-list zeros before other dirty links", () => {
    expect(etsyInboundHydratePriority(undefined, 4)).toBe(0);
    expect(etsyInboundHydratePriority({ quantity: 0 }, 4)).toBe(1);
    expect(etsyInboundHydratePriority({ quantity: 0 }, 0)).toBe(2);
    expect(etsyInboundHydratePriority({ quantity: 3 }, 4)).toBe(3);
  });
});

describe("etsyListingIsNotActive", () => {
  it("treats inactive, draft, and ended states as off the shop", () => {
    expect(etsyListingIsNotActive("inactive")).toBe(true);
    expect(etsyListingIsNotActive("draft")).toBe(true);
    expect(etsyListingIsNotActive("expired")).toBe(true);
    expect(etsyListingIsNotActive("sold_out")).toBe(true);
    expect(etsyListingIsNotActive("removed")).toBe(true);
  });

  it("treats active as still live", () => {
    expect(etsyListingIsNotActive("active")).toBe(false);
    expect(etsyListingIsNotActive(null)).toBe(false);
  });
});

describe("etsyHydrateBelongsInActiveCatalog", () => {
  it("keeps active listings and drops inactive/draft so deactivate cannot pull qty 0", () => {
    expect(etsyHydrateBelongsInActiveCatalog("active")).toBe(true);
    expect(etsyHydrateBelongsInActiveCatalog(null)).toBe(true);
    expect(etsyHydrateBelongsInActiveCatalog("inactive")).toBe(false);
    expect(etsyHydrateBelongsInActiveCatalog("draft")).toBe(false);
  });
});
