import { beforeEach, describe, expect, it, vi } from "vitest";

const { ebayJson, fetchLiveInventoryItem } = vi.hoisted(() => ({
  ebayJson: vi.fn(),
  fetchLiveInventoryItem: vi.fn(),
}));

vi.mock("./client", () => ({ ebayJson }));
vi.mock("./passthrough-push", () => ({
  fetchLiveInventoryItem,
  buildPassthroughLiveOverlayBody: (
    _live: unknown,
    patch: { quantity?: number }
  ) => ({
    availability: { shipToLocationAvailability: { quantity: patch.quantity } },
  }),
}));

import { pushEbayAbsoluteQuantity } from "./quantity";

describe("pushEbayAbsoluteQuantity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ebayJson.mockResolvedValue({});
  });

  it("PUTs inventory quantity 0 instead of bulk_update_price_quantity", async () => {
    fetchLiveInventoryItem.mockResolvedValueOnce({
      condition: "USED_EXCELLENT",
      product: { title: "Coin" },
    });

    await pushEbayAbsoluteQuantity({
      accessToken: "t",
      sku: "inw123",
      quantity: 0,
      offerId: "offer-1",
    });

    expect(ebayJson).toHaveBeenCalledWith(
      "t",
      "/sell/inventory/v1/inventory_item/inw123",
      "PUT",
      expect.objectContaining({
        availability: { shipToLocationAvailability: { quantity: 0 } },
      })
    );
    expect(ebayJson).not.toHaveBeenCalledWith(
      expect.anything(),
      "/sell/inventory/v1/bulk_update_price_quantity",
      expect.anything(),
      expect.anything()
    );
  });

  it("uses bulk_update_price_quantity for positive stock", async () => {
    await pushEbayAbsoluteQuantity({
      accessToken: "t",
      sku: "sku-1",
      quantity: 2,
      offerId: "offer-1",
    });

    expect(fetchLiveInventoryItem).not.toHaveBeenCalled();
    expect(ebayJson).toHaveBeenCalledWith(
      "t",
      "/sell/inventory/v1/bulk_update_price_quantity",
      "POST",
      {
        requests: [
          {
            sku: "sku-1",
            shipToLocationAvailability: { quantity: 2 },
            offers: [{ offerId: "offer-1", availableQuantity: 2 }],
          },
        ],
      }
    );
  });
});
