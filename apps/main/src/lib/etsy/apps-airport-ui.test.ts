import { describe, expect, it } from "vitest";
import { etsyListedOnMyItems, etsyListingUiStatus } from "./apps-airport";

describe("etsyListingUiStatus", () => {
  it("returns Live only when READY_TO_PUBLISH and remote state is active", () => {
    expect(
      etsyListingUiStatus({
        readiness: "READY_TO_PUBLISH",
        contentHealth: "HEALTHY",
        inventoryHealth: "HEALTHY",
        issueCode: null,
        storeItemStatus: "active",
        remoteListingState: "active",
      })
    ).toBe("Live");
  });

  it("does not treat READY_TO_PUBLISH as Live without remoteListingState", () => {
    // My Items "Listed On" must pass remoteListingState or the Etsy chip stays dark.
    expect(
      etsyListingUiStatus({
        readiness: "READY_TO_PUBLISH",
        contentHealth: "HEALTHY",
        inventoryHealth: "HEALTHY",
        issueCode: null,
        storeItemStatus: "active",
      })
    ).not.toBe("Live");
  });
});

describe("etsyListedOnMyItems", () => {
  it("lights the chip for buyer-live Etsy even when Sync Airport Needs attention", () => {
    expect(
      etsyListedOnMyItems({
        remoteListingState: "active",
        storeItemStatus: "active",
      })
    ).toBe(true);
  });

  it("keeps the chip dark for drafts and ended INW items", () => {
    expect(
      etsyListedOnMyItems({
        remoteListingState: "draft",
        storeItemStatus: "active",
      })
    ).toBe(false);
    expect(
      etsyListedOnMyItems({
        remoteListingState: "active",
        storeItemStatus: "ended",
      })
    ).toBe(false);
  });
});
