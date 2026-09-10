import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitTracking } from "../rate-limit-tracker";
import {
  isShopifyConcurrentModification,
  parseShopifyCallLimit,
  parseShopifyRetryAfterMs,
  resetShopifyClientForTests,
  shopifyGet,
  shopifyGetWithPagination,
  ShopifyApiError,
} from "./client";

const SHOP = "demo.myshopify.com";
const VERSION = "2024-10";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("isShopifyConcurrentModification", () => {
  it("matches Shopify's 422 product-lock copy", () => {
    expect(
      isShopifyConcurrentModification(
        422,
        "This product is currently being modified. Please try again later."
      )
    ).toBe(true);
  });

  it("does not treat other 422s as a lock", () => {
    expect(isShopifyConcurrentModification(422, "Title can't be blank")).toBe(false);
    expect(
      isShopifyConcurrentModification(429, "This product is currently being modified.")
    ).toBe(false);
  });
});

describe("parseShopifyRetryAfterMs", () => {
  it("parses delay-seconds and caps at 15s", () => {
    expect(parseShopifyRetryAfterMs("2")).toBe(2000);
    expect(parseShopifyRetryAfterMs("120")).toBe(15_000);
    expect(parseShopifyRetryAfterMs("0")).toBe(0);
  });

  it("parses HTTP-date Retry-After", () => {
    const now = Date.parse("Wed, 19 Aug 2026 19:00:00 GMT");
    expect(parseShopifyRetryAfterMs("Wed, 19 Aug 2026 19:00:05 GMT", now)).toBe(5000);
  });

  it("returns null for missing or invalid values", () => {
    expect(parseShopifyRetryAfterMs(null)).toBeNull();
    expect(parseShopifyRetryAfterMs("")).toBeNull();
    expect(parseShopifyRetryAfterMs("not-a-date")).toBeNull();
  });
});

describe("parseShopifyCallLimit", () => {
  it("parses used/max", () => {
    expect(parseShopifyCallLimit("32/40")).toEqual({ used: 32, max: 40 });
    expect(parseShopifyCallLimit(" 39 / 40 ")).toEqual({ used: 39, max: 40 });
  });

  it("returns null when missing", () => {
    expect(parseShopifyCallLimit(null)).toBeNull();
    expect(parseShopifyCallLimit("nope")).toBeNull();
  });
});

describe("shopifyGet throttling and retries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetShopifyClientForTests();
    resetRateLimitTracking("shopify", `shop:${SHOP}`);
  });

  it("honors Retry-After on 429 then succeeds", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Exceeded 2 calls per second for api client", {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ product: { id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    const body = await shopifyGet<{ product: { id: number } }>(
      "token",
      SHOP,
      VERSION,
      "/products/1.json"
    );
    expect(body.product.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries paginated GETs on 429", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Exceeded 2 calls per second for api client", {
          status: 429,
          headers: { "Retry-After": "0" },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { products: [{ id: 9 }] },
          {
            headers: {
              Link: '<https://demo.myshopify.com/admin/api/2024-10/products.json?page_info=next>; rel="next"',
            },
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const page = await shopifyGetWithPagination<{ products: { id: number }[] }>(
      "token",
      SHOP,
      VERSION,
      "/products.json?limit=250"
    );
    expect(page.data.products?.[0]?.id).toBe(9);
    expect(page.nextUrl).toContain("page_info=next");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serializes parallel requests to the same shop", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 40));
      inFlight -= 1;
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      shopifyGet("token", SHOP, VERSION, "/products/1.json"),
      shopifyGet("token", SHOP, VERSION, "/products/2.json"),
    ]);
    expect(maxInFlight).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws ShopifyApiError after 429 retries are exhausted", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Exceeded 2 calls per second for api client", {
        status: 429,
        headers: { "Retry-After": "0" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(shopifyGet("token", SHOP, VERSION, "/products/1.json")).rejects.toMatchObject({
      name: "ShopifyApiError",
      status: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(7);
  }, 20_000);

  it("throws ShopifyApiError for non-429 failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ errors: "Not found" }, { status: 404 })));
    await expect(shopifyGet("token", SHOP, VERSION, "/products/1.json")).rejects.toBeInstanceOf(
      ShopifyApiError
    );
  });
});
