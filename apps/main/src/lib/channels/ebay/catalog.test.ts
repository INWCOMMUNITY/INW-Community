import { describe, expect, it } from "vitest";
import { applyCatalogProductToInventoryBody } from "./catalog";

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
