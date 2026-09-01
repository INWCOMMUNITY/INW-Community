import { describe, expect, it } from "vitest";
import { formatRemoteDeletedMessage } from "./remote-deleted-copy";

describe("formatRemoteDeletedMessage", () => {
  it("asks about INW only when no other shops are linked", () => {
    expect(formatRemoteDeletedMessage({ deletedProvider: "ebay", otherProviders: [] })).toEqual({
      headline: "This listing was deleted on eBay.",
      body: "Delete it on INW too, or keep it listed here.",
    });
  });

  it("names the other connected shops", () => {
    expect(
      formatRemoteDeletedMessage({ deletedProvider: "etsy", otherProviders: ["ebay", "wix"] })
    ).toEqual({
      headline: "This listing was deleted on Etsy.",
      body: "Delete it on INW and eBay and Wix too, or keep those listings up.",
    });
  });
});
