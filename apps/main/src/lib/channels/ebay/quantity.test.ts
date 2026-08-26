import { beforeEach, describe, expect, it, vi } from "vitest";
import { EbayApiError } from "./errors";

const { ebayJson, ebayGet, fetchLiveInventoryItem } = vi.hoisted(() => ({
  ebayJson: vi.fn(),
  ebayGet: vi.fn(),
  fetchLiveInventoryItem: vi.fn(),
}));

vi.mock("./client", () => ({ ebayJson, ebayGet }));
vi.mock("./passthrough-push", () => ({
  fetchLiveInventoryItem,
  buildPassthroughLiveOverlayBody: (
    _live: unknown,
    patch: { quantity?: number }
  ) => ({
    availability: { shipToLocationAvailability: { quantity: patch.quantity } },
  }),
  overlayOfferAvailableQuantity: (live: Record<string, unknown>, quantity: number) => ({
    ...live,
    availableQuantity: quantity,
  }),
}));

import { assertBulkPriceQuantityOk, pushEbayAbsoluteQuantity } from "./quantity";

describe("pushEbayAbsoluteQuantity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ebayJson.mockResolvedValue({});
  });

  it("zeros the published offer first, then PUTs inventory quantity 0", async () => {
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

    expect(ebayJson).toHaveBeenNthCalledWith(1, "t", "/sell/inventory/v1/bulk_update_price_quantity", "POST", {
      requests: [{ sku: "inw123", offers: [{ offerId: "offer-1", availableQuantity: 0 }] }],
    });
    expect(ebayJson).toHaveBeenNthCalledWith(
      2,
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
      "POST",
      expect.objectContaining({
        requests: [
          expect.objectContaining({
            shipToLocationAvailability: { quantity: 0 },
            offers: expect.anything(),
          }),
        ],
      })
    );
  });

  it("falls back to PUT offer when offer-only bulk qty 0 fails", async () => {
    ebayJson
      .mockRejectedValueOnce(new Error("[#25002] A user error has occurred"))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    ebayGet.mockResolvedValueOnce({
      categoryId: "39458",
      availableQuantity: 1,
      listingPolicies: { paymentPolicyId: "p1" },
    });
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

    expect(ebayGet).toHaveBeenCalledWith("t", "/sell/inventory/v1/offer/offer-1");
    expect(ebayJson).toHaveBeenCalledWith(
      "t",
      "/sell/inventory/v1/offer/offer-1",
      "PUT",
      expect.objectContaining({ availableQuantity: 0, categoryId: "39458" })
    );
  });

  it("PUTs inventory quantity 0 without an offer write when offerId is missing", async () => {
    fetchLiveInventoryItem.mockResolvedValueOnce({
      condition: "USED_EXCELLENT",
      product: { title: "Coin" },
    });

    await pushEbayAbsoluteQuantity({
      accessToken: "t",
      sku: "inw123",
      quantity: 0,
    });

    expect(ebayJson).toHaveBeenCalledTimes(1);
    expect(ebayJson).toHaveBeenCalledWith(
      "t",
      "/sell/inventory/v1/inventory_item/inw123",
      "PUT",
      expect.objectContaining({
        availability: { shipToLocationAvailability: { quantity: 0 } },
      })
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

  it("throws when bulk_update_price_quantity returns HTTP 200 with inner 400", async () => {
    ebayJson.mockResolvedValueOnce({
      responses: [
        {
          statusCode: 400,
          errors: [{ errorId: 25002, message: "A user error has occurred." }],
        },
      ],
    });

    await expect(
      pushEbayAbsoluteQuantity({
        accessToken: "t",
        sku: "sku-1",
        quantity: 2,
        offerId: "offer-1",
      })
    ).rejects.toBeInstanceOf(EbayApiError);
  });
});

describe("assertBulkPriceQuantityOk", () => {
  it("ignores an empty success body", () => {
    expect(() => assertBulkPriceQuantityOk({}, "/sell/inventory/v1/bulk_update_price_quantity")).not.toThrow();
  });
});
