import { describe, expect, it } from "vitest";
import {
  listedOnManageHref,
  listedOnSettingsHref,
  listedOnTipCopy,
} from "@/lib/apps-airport-listed-on-tip";
import { APPS_AIRPORT_ETSY_PATH, APPS_AIRPORT_ETSY_SETTINGS_PATH } from "@/lib/etsy/apps-airport";
import {
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
} from "@/lib/shopify/apps-airport";

describe("listedOnTipCopy", () => {
  it("uses Listed on + Manage for filled slots", () => {
    expect(listedOnTipCopy({ mode: "listed", label: "Etsy", channelReady: true })).toEqual({
      title: "Listed on Etsy",
      ctaLabel: "Manage",
    });
    expect(listedOnTipCopy({ mode: "listed", label: "Shopify", channelReady: false })).toEqual({
      title: "Listed on Shopify",
      ctaLabel: "Manage",
    });
  });

  it("uses List on + List when channel is ready", () => {
    expect(listedOnTipCopy({ mode: "list", label: "Etsy", channelReady: true })).toEqual({
      title: "List on Etsy",
      ctaLabel: "List",
    });
    expect(listedOnTipCopy({ mode: "list", label: "Shopify", channelReady: true })).toEqual({
      title: "List on Shopify",
      ctaLabel: "List",
    });
  });

  it("uses List on + Connect when channel is not ready", () => {
    expect(listedOnTipCopy({ mode: "list", label: "Etsy", channelReady: false })).toEqual({
      title: "List on Etsy",
      ctaLabel: "Connect",
    });
    expect(listedOnTipCopy({ mode: "list", label: "Shopify", channelReady: false })).toEqual({
      title: "List on Shopify",
      ctaLabel: "Connect",
    });
  });
});

describe("listedOn href helpers", () => {
  it("points Connect to channel settings", () => {
    expect(listedOnSettingsHref("etsy")).toBe(APPS_AIRPORT_ETSY_SETTINGS_PATH);
    expect(listedOnSettingsHref("shopify")).toBe(APPS_AIRPORT_SHOPIFY_SETTINGS_PATH);
  });

  it("points Manage to channel hub", () => {
    expect(listedOnManageHref("etsy")).toBe(APPS_AIRPORT_ETSY_PATH);
    expect(listedOnManageHref("shopify")).toBe(APPS_AIRPORT_SHOPIFY_PATH);
  });
});
