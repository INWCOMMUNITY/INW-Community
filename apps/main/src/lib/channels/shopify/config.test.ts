import { describe, expect, it } from "vitest";
import { normalizeShopDomain, shopDomainFromHostParam } from "./config";
import { resolveShopifyCallbackShop } from "./oauth";

describe("normalizeShopDomain", () => {
  it("accepts slug and myshopify host", () => {
    expect(normalizeShopDomain("Cool-Shop")).toBe("cool-shop.myshopify.com");
    expect(normalizeShopDomain("https://Cool-Shop.myshopify.com/admin")).toBe(
      "cool-shop.myshopify.com"
    );
  });

  it("parses admin.shopify.com/store/{slug}", () => {
    expect(normalizeShopDomain("https://admin.shopify.com/store/cool-shop")).toBe(
      "cool-shop.myshopify.com"
    );
  });

  it("rejects custom storefront domains", () => {
    expect(normalizeShopDomain("shop.example.com")).toBeNull();
  });
});

describe("shopDomainFromHostParam", () => {
  it("decodes Shopify host base64", () => {
    const host = Buffer.from("admin.shopify.com/store/cool-shop").toString("base64");
    expect(shopDomainFromHostParam(host)).toBe("cool-shop.myshopify.com");
  });
});

describe("resolveShopifyCallbackShop", () => {
  it("uses Shopify callback shop when the typed slug differs", () => {
    const resolved = resolveShopifyCallbackShop({
      shopParam: "real-store.myshopify.com",
      hostParam: null,
      stateShop: "wrong-name.myshopify.com",
    });
    expect(resolved.shop).toBe("real-store.myshopify.com");
    expect(resolved.typed).toBe("wrong-name.myshopify.com");
  });

  it("falls back to typed shop when callback shop is missing", () => {
    const resolved = resolveShopifyCallbackShop({
      shopParam: null,
      hostParam: null,
      stateShop: "cool-shop",
    });
    expect(resolved.shop).toBe("cool-shop.myshopify.com");
  });
});
