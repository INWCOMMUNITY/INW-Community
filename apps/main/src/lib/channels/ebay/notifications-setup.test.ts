import { describe, expect, it } from "vitest";
import { isEbayCommerceNotificationPermissionError } from "./commerce-notifications";
import {
  ebayPlatformNotificationsNeedRepair,
  ebayListingReviseNotificationsEnabled,
  ebayItemRevisedNotificationEnabled,
} from "./notifications-setup";

describe("ebayPlatformNotificationsNeedRepair", () => {
  it("does not repair when live Platform Notifications are already subscribed and secured", () => {
    expect(
      ebayPlatformNotificationsNeedRepair({
        storedEnabledAndSecured: true,
        liveFetched: true,
        liveSubscribed: true,
        liveUrlSecured: true,
        listingReviseEventsEnabled: true,
      })
    ).toBe(false);
  });

  it("skips repair when live prefs cannot be fetched", () => {
    expect(
      ebayPlatformNotificationsNeedRepair({
        storedEnabledAndSecured: true,
        liveFetched: false,
        liveSubscribed: false,
        liveUrlSecured: false,
      })
    ).toBe(false);
  });

  it("repairs when the stored URL is missing or unsecured", () => {
    expect(
      ebayPlatformNotificationsNeedRepair({
        storedEnabledAndSecured: false,
        liveFetched: true,
        liveSubscribed: true,
        liveUrlSecured: true,
      })
    ).toBe(true);
  });

  it("repairs when live delivery is disabled", () => {
    expect(
      ebayPlatformNotificationsNeedRepair({
        storedEnabledAndSecured: true,
        liveFetched: true,
        liveSubscribed: false,
        liveUrlSecured: true,
      })
    ).toBe(true);
  });

  it("does not repair when ItemRevised is already enabled", () => {
    expect(
      ebayPlatformNotificationsNeedRepair({
        storedEnabledAndSecured: true,
        liveFetched: true,
        liveSubscribed: true,
        liveUrlSecured: true,
        listingReviseEventsEnabled: true,
      })
    ).toBe(false);
  });

  it("repairs when ItemRevised is missing", () => {
    expect(
      ebayPlatformNotificationsNeedRepair({
        storedEnabledAndSecured: true,
        liveFetched: true,
        liveSubscribed: true,
        liveUrlSecured: true,
        listingReviseEventsEnabled: false,
      })
    ).toBe(true);
  });
});

describe("ebayListingReviseNotificationsEnabled", () => {
  it("detects ItemRevised and commerce qty/price topics", () => {
    expect(ebayListingReviseNotificationsEnabled(["ItemSold", "ItemRevised"])).toBe(true);
    expect(ebayListingReviseNotificationsEnabled(["ItemSold"])).toBe(false);
  });

  it("treats only Platform ItemRevised as a subscribe-XML repair signal", () => {
    expect(ebayItemRevisedNotificationEnabled(["ItemSold", "ItemRevised"])).toBe(true);
    expect(ebayItemRevisedNotificationEnabled(["ITEM_AVAILABILITY"])).toBe(false);
    expect(ebayItemRevisedNotificationEnabled(["ItemSold"])).toBe(false);
  });
});

describe("isEbayCommerceNotificationPermissionError", () => {
  it("recognizes the cron #1100 403", () => {
    expect(
      isEbayCommerceNotificationPermissionError(
        "[#1100 · ACCESS · REQUEST · HTTP 403] Insufficient permissions to fulfill the request."
      )
    ).toBe(true);
  });

  it("does not swallow unrelated commerce errors", () => {
    expect(isEbayCommerceNotificationPermissionError("destination-create-empty-id")).toBe(false);
  });
});
