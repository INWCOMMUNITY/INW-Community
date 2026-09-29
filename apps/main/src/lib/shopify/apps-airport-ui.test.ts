import { describe, expect, it } from "vitest";
import {
  shopifyListingUiStatus,
  shopifyRemountSellerCopy,
  shopifyStorefrontProductUrl,
} from "./apps-airport";

describe("shopify listing UI status", () => {
  it("treats unpublished issue codes as Unpublished not Needs attention", () => {
    expect(
      shopifyListingUiStatus({
        readiness: "ACTION_REQUIRED",
        contentHealth: "HEALTHY",
        inventoryHealth: "HEALTHY",
        issueCode: "UNPUBLISHED_ONLINE_STORE",
      })
    ).toBe("Unpublished");
  });

  it("returns Live for healthy READY_TO_PUBLISH", () => {
    expect(
      shopifyListingUiStatus({
        readiness: "READY_TO_PUBLISH",
        contentHealth: "HEALTHY",
        inventoryHealth: "HEALTHY",
        issueCode: null,
      })
    ).toBe("Live");
  });
});

describe("shopify remount seller copy", () => {
  it("hides raw job states behind seller language", () => {
    expect(shopifyRemountSellerCopy({ state: "RUNNING", message: null, errorCode: null })).toMatchObject({
      tone: "progress",
      title: "Restoring listings after reconnect…",
    });
  });
});

describe("shopifyStorefrontProductUrl", () => {
  it("builds myshopify product URL from handle", () => {
    expect(shopifyStorefrontProductUrl("demo.myshopify.com", "blue-mug")).toBe(
      "https://demo.myshopify.com/products/blue-mug"
    );
  });
});
