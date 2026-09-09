import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  shopifyGet: vi.fn(),
  shopifyJson: vi.fn(),
  ShopifyApiError: class ShopifyApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = "ShopifyApiError";
      this.status = status;
      this.body = body;
    }
  },
}));

import { shopifyGet, shopifyJson } from "./client";
import {
  assignShopifyProductCollection,
  ensureShopifyCollection,
  isShopifyCollectionNoise,
} from "./collections";

const getMock = vi.mocked(shopifyGet);
const jsonMock = vi.mocked(shopifyJson);

describe("isShopifyCollectionNoise", () => {
  it("treats marketing collections as noise", () => {
    expect(isShopifyCollectionNoise("Frontpage")).toBe(true);
    expect(isShopifyCollectionNoise("Video Games")).toBe(false);
  });
});

describe("ensureShopifyCollection / assignShopifyProductCollection", () => {
  beforeEach(() => {
    getMock.mockReset();
    jsonMock.mockReset();
  });

  it("reuses an existing custom collection by title", async () => {
    getMock.mockResolvedValueOnce({
      custom_collections: [{ id: 44, title: "Food & Drink" }],
    });
    const id = await ensureShopifyCollection("tok", "shop.myshopify.com", "2024-10", "Food & Drink");
    expect(id).toBe(44);
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it("creates a collection then assigns a collect", async () => {
    getMock
      .mockResolvedValueOnce({ custom_collections: [] })
      .mockResolvedValueOnce({ collects: [] });
    jsonMock
      .mockResolvedValueOnce({ custom_collection: { id: 99, title: "Video Games & Consoles" } })
      .mockResolvedValueOnce({ collect: { id: 1 } });

    const id = await ensureShopifyCollection(
      "tok",
      "shop.myshopify.com",
      "2024-10",
      "Video Games & Consoles"
    );
    expect(id).toBe(99);
    const assigned = await assignShopifyProductCollection(
      "tok",
      "shop.myshopify.com",
      "2024-10",
      "123",
      99
    );
    expect(assigned).toBe(true);
    expect(jsonMock).toHaveBeenCalledWith(
      "tok",
      "shop.myshopify.com",
      "2024-10",
      "/collects.json",
      "POST",
      { collect: { product_id: 123, collection_id: 99 } }
    );
  });
});
