import { describe, expect, it } from "vitest";
import { normalizeShopifyShopDomain } from "./shop-domain";

describe("normalizeShopifyShopDomain", () => {
  it("accepts the known production shop hostname", () => {
    expect(normalizeShopifyShopDomain("northwestcommunity.myshopify.com")).toBe(
      "northwestcommunity.myshopify.com"
    );
  });

  it("canonicalizes case and surrounding whitespace", () => {
    expect(normalizeShopifyShopDomain("NORTHWESTCOMMUNITY.MYSHOPIFY.COM")).toBe(
      "northwestcommunity.myshopify.com"
    );
    expect(normalizeShopifyShopDomain(" northwestcommunity.myshopify.com ")).toBe(
      "northwestcommunity.myshopify.com"
    );
  });

  it("accepts https store and admin URLs", () => {
    expect(normalizeShopifyShopDomain("https://northwestcommunity.myshopify.com")).toBe(
      "northwestcommunity.myshopify.com"
    );
    expect(normalizeShopifyShopDomain("https://northwestcommunity.myshopify.com/")).toBe(
      "northwestcommunity.myshopify.com"
    );
    expect(normalizeShopifyShopDomain("https://northwestcommunity.myshopify.com/admin")).toBe(
      "northwestcommunity.myshopify.com"
    );
    expect(normalizeShopifyShopDomain("http://northwestcommunity.myshopify.com/admin/settings")).toBe(
      "northwestcommunity.myshopify.com"
    );
  });

  it("accepts a bare store handle", () => {
    expect(normalizeShopifyShopDomain("northwestcommunity")).toBe("northwestcommunity.myshopify.com");
  });

  it("strips query/fragment from hostname-shaped or URL-shaped input", () => {
    expect(normalizeShopifyShopDomain("northwestcommunity.myshopify.com?x=1")).toBe(
      "northwestcommunity.myshopify.com"
    );
    expect(normalizeShopifyShopDomain("https://northwestcommunity.myshopify.com/admin?foo=1#bar")).toBe(
      "northwestcommunity.myshopify.com"
    );
  });

  it("rejects custom domains and suffix tricks", () => {
    expect(normalizeShopifyShopDomain("example.com")).toBeNull();
    expect(normalizeShopifyShopDomain("northwestcommunity.myshopify.com.evil.com")).toBeNull();
    expect(normalizeShopifyShopDomain("evilmyshopify.com")).toBeNull();
    expect(normalizeShopifyShopDomain("https://example.com/northwestcommunity.myshopify.com")).toBeNull();
  });

  it("rejects invalid schemes, credentials, ports, and control characters", () => {
    expect(normalizeShopifyShopDomain("javascript:alert(1)")).toBeNull();
    expect(normalizeShopifyShopDomain("ftp://northwestcommunity.myshopify.com")).toBeNull();
    expect(normalizeShopifyShopDomain("https://user:pass@northwestcommunity.myshopify.com")).toBeNull();
    expect(normalizeShopifyShopDomain("https://northwestcommunity.myshopify.com:8443")).toBeNull();
    expect(normalizeShopifyShopDomain("northwestcommunity.myshopify.com\u0000")).toBeNull();
    expect(normalizeShopifyShopDomain("")).toBeNull();
    expect(normalizeShopifyShopDomain("-bad.myshopify.com")).toBeNull();
  });
});
