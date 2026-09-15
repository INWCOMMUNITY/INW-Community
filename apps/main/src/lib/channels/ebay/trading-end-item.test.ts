import { describe, expect, it } from "vitest";
import {
  isEbayTradingListingAlreadyEnded,
  buildSubscribeEbayNotificationsXml,
  buildUnsubscribeEbayNotificationsXml,
} from "./trading";

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

describe("buildSubscribeEbayNotificationsXml", () => {
  it("disables ItemRevised so Hub Revise is not stalled by notification delivery", () => {
    const xml = buildSubscribeEbayNotificationsXml("https://example.com/api/channels/ebay/webhook?secret=x");
    expect(xml).toContain("<ApplicationEnable>Enable</ApplicationEnable>");
    expect(xml).toMatch(
      /<EventType>ItemRevised<\/EventType>\s*<EventEnable>Disable<\/EventEnable>/
    );
    expect(xml).toMatch(/<EventType>ItemSold<\/EventType>\s*<EventEnable>Enable<\/EventEnable>/);
  });
});

describe("buildUnsubscribeEbayNotificationsXml", () => {
  it("disables application delivery and sale/revise events", () => {
    const xml = buildUnsubscribeEbayNotificationsXml();
    expect(xml).toContain("<ApplicationEnable>Disable</ApplicationEnable>");
    expect(xml).toContain("<EventType>ItemRevised</EventType>");
    expect(xml).toContain("<EventType>ItemSold</EventType>");
    expect(xml).toContain("<EventEnable>Disable</EventEnable>");
    expect(xml).not.toContain("<ApplicationEnable>Enable</ApplicationEnable>");
  });
});
