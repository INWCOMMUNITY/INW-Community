import { afterEach, describe, expect, it } from "vitest";
import { shopifyProductContentFingerprint } from "database";
import { resolveShopifyMediaSourceUrl, resolveShopifyMediaSourceUrls } from "./media-source-url";

const PREV = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  APP_URL: process.env.APP_URL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(PREV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveShopifyMediaSourceUrl", () => {
  it("passes through public https URLs", () => {
    const result = resolveShopifyMediaSourceUrl(
      "https://cdn.example.com/listing/a.jpg?x=1"
    );
    expect(result).toEqual({
      ok: true,
      url: "https://cdn.example.com/listing/a.jpg?x=1",
    });
  });

  it("absolutizes relative uploads with NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.inwcommunity.com/";
    const result = resolveShopifyMediaSourceUrl("/uploads/listing/a.jpg");
    expect(result).toEqual({
      ok: true,
      url: "https://www.inwcommunity.com/uploads/listing/a.jpg",
    });
  });

  it("rejects localhost even when absolute", () => {
    const result = resolveShopifyMediaSourceUrl("http://localhost:3000/uploads/a.jpg");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MEDIA_URL_NOT_PUBLIC");
  });

  it("rejects relative URLs when no origin is configured", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SHOPIFY_APP_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.APP_URL;
    const result = resolveShopifyMediaSourceUrl("/uploads/a.jpg");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MEDIA_URL_NOT_PUBLIC");
  });
});

describe("resolveShopifyMediaSourceUrls", () => {
  it("dedupes resolved URLs", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.inwcommunity.com";
    const result = resolveShopifyMediaSourceUrls([
      "/uploads/a.jpg",
      "https://www.inwcommunity.com/uploads/a.jpg",
    ]);
    expect(result).toEqual({
      ok: true,
      urls: ["https://www.inwcommunity.com/uploads/a.jpg"],
    });
  });
});

describe("product content fingerprint photo parity", () => {
  it("desire and worker fingerprints match when photos are present", () => {
    const photos = ["https://cdn.example.com/a.jpg"];
    const desireFp = shopifyProductContentFingerprint({
      title: "T",
      description: "D",
      photos,
    });
    const workerFp = shopifyProductContentFingerprint({
      title: "T",
      description: "D",
      photos,
    });
    const withoutPhotos = shopifyProductContentFingerprint({
      title: "T",
      description: "D",
    });
    expect(desireFp).toBe(workerFp);
    expect(desireFp).not.toBe(withoutPhotos);
  });
});
