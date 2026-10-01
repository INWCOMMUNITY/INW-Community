import { describe, expect, it } from "vitest";
import {
  etsyMoneyFromCents,
  etsyProductContentFingerprint,
  etsyUpdateListingContentDedupeKey,
  etsyVariantContentFingerprint,
  normalizeEtsyPhotoUrls,
} from "database";

describe("etsy content fingerprints", () => {
  it("normalizes photo urls and fingerprints product fields", () => {
    expect(normalizeEtsyPhotoUrls([" a ", "a", "", "b"])).toEqual(["a", "b"]);
    const a = etsyProductContentFingerprint({
      title: " Mug ",
      description: "hot",
      photos: ["https://cdn.example/a.jpg"],
    });
    const b = etsyProductContentFingerprint({
      title: "Mug",
      description: "hot",
      photos: ["https://cdn.example/a.jpg"],
    });
    expect(a).toBe(b);
  });

  it("fingerprints variant price/sku and builds dedupe keys", () => {
    const fp = etsyVariantContentFingerprint({ priceCents: 1200, sku: " ABC " });
    expect(fp).toHaveLength(64);
    expect(etsyMoneyFromCents(1999)).toEqual({ amount: 1999, divisor: 100, currency_code: "USD" });
    expect(
      etsyUpdateListingContentDedupeKey({
        connectionId: "c1",
        storeItemId: "i1",
        storeVariantId: "v1",
        productDesiredVersion: 2,
        variantDesiredVersion: 3,
      })
    ).toBe("UPDATE_LISTING_CONTENT:c1:i1:v1:p2:v3");
  });
});
