import { describe, expect, it } from "vitest";
import { isEbayTradingListingAlreadyEnded } from "./trading";

describe("isEbayTradingListingAlreadyEnded", () => {
  it("treats already-closed EndItem errors as success", () => {
    expect(isEbayTradingListingAlreadyEnded("The auction has already been closed. (1047)")).toBe(
      true
    );
    expect(isEbayTradingListingAlreadyEnded("This item cannot be accessed.")).toBe(true);
    expect(isEbayTradingListingAlreadyEnded("Item does not exist. (17)")).toBe(true);
  });

  it("does not treat unrelated failures as already ended", () => {
    expect(isEbayTradingListingAlreadyEnded("Auth token is invalid.")).toBe(false);
    expect(isEbayTradingListingAlreadyEnded("Internal error to the application.")).toBe(false);
  });
});
