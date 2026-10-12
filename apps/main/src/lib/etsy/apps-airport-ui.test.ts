import { describe, expect, it } from "vitest";
import { etsyListingUiStatus } from "./apps-airport";

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
