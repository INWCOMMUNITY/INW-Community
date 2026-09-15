import { describe, expect, it } from "vitest";
import { ebayHubContentNeedsInventoryWrite, hubSnapshotAsSyncItem } from "./hub-content-catchup";

describe("Hub content catch-up vs live Inventory", () => {
  it("writes title when Seller Hub differs from inventory_item product.title", () => {
    const hub = hubSnapshotAsSyncItem({
      title: "Bear Clock v2",
      description: "<p>Hub body</p>",
      inventoryPinPhotos: ["https://i.ebayimg.com/images/g/hub/s-l1600.jpg"],
    });
    const needs = ebayHubContentNeedsInventoryWrite(
      {
        product: {
          title: "Bear Clock",
          imageUrls: ["https://i.ebayimg.com/images/g/old/s-l1600.jpg"],
        },
      },
      hub,
      { listingDescription: "<p>Old offer</p>" }
    );
    expect(needs.title).toBe(true);
    expect(needs.description).toBe(true);
  });

  it("does not write when Hub already matches live Inventory/offer", () => {
    const hub = hubSnapshotAsSyncItem({
      title: "Bear Clock",
      description: "Bear Clock",
      inventoryPinPhotos: ["https://i.ebayimg.com/images/g/hub/s-l1600.jpg"],
    });
    const needs = ebayHubContentNeedsInventoryWrite(
      {
        product: {
          title: "Bear Clock",
          imageUrls: ["https://i.ebayimg.com/images/g/hub/s-l1600.jpg"],
        },
      },
      hub,
      { listingDescription: "<p>Bear Clock</p>" }
    );
    expect(needs).toEqual({ title: false, photos: false, description: false });
  });
});
