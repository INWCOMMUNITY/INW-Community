import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  ebayGet: vi.fn(),
}));

vi.mock("./oauth", () => ({
  withEbayApplicationTokenRetry: async (fn: (token: string) => Promise<unknown>) => fn("token"),
}));

import { ebayGet } from "./client";
import {
  applyCatalogProductToInventoryBody,
  enrichInventoryBodyWithCatalogProduct,
  resetEbayCatalogSearchCache,
} from "./catalog";

const mockedGet = vi.mocked(ebayGet);

describe("applyCatalogProductToInventoryBody", () => {
  it("sets product.epid when a catalog match exists", () => {
    const body = applyCatalogProductToInventoryBody(
      { product: { title: "Widget" } },
      { epid: "1234567890", title: "Widget" }
    );
    expect((body.product as { epid?: string }).epid).toBe("1234567890");
  });

  it("leaves the body unchanged when there is no match", () => {
    const body = { product: { title: "Widget" } };
    expect(applyCatalogProductToInventoryBody(body, null)).toEqual(body);
  });
});

describe("enrichInventoryBodyWithCatalogProduct", () => {
  beforeEach(() => {
    resetEbayCatalogSearchCache();
    mockedGet.mockReset();
  });

  it("skips later searches after Catalog API #1100 HTTP 403", async () => {
    mockedGet.mockRejectedValue(
      new Error("[#1100 · ACCESS · REQUEST · HTTP 403] Insufficient permissions to fulfill the request.")
    );
    const body = { product: { title: "Vintage Bear Clock" } };
    await enrichInventoryBodyWithCatalogProduct({
      itemTitle: "Vintage Bear Clock",
      categoryId: "261605",
      body,
    });
    await enrichInventoryBodyWithCatalogProduct({
      itemTitle: "Vintage Bear Clock Red Small",
      categoryId: "261605",
      body,
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
