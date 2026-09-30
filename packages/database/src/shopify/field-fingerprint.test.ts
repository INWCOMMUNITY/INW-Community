import { describe, expect, it } from "vitest";
import {
  shopifyDescriptionFieldFingerprint,
  shopifyFieldFingerprint,
} from "./field-fingerprint";

describe("shopifyFieldFingerprint", () => {
  it("is stable for title and sku", () => {
    expect(shopifyFieldFingerprint("TITLE", " Blue Bowl ")).toBe(
      shopifyFieldFingerprint("TITLE", "Blue Bowl")
    );
    expect(shopifyFieldFingerprint("SKU", " abc ")).toBe(shopifyFieldFingerprint("SKU", "abc"));
  });

  it("distinguishes price changes", () => {
    expect(shopifyFieldFingerprint("PRICE", 1000)).not.toBe(shopifyFieldFingerprint("PRICE", 1100));
  });

  it("normalizes equivalent description HTML whitespace", () => {
    const a = shopifyDescriptionFieldFingerprint("<p>Hello</p>\n\n");
    const b = shopifyDescriptionFieldFingerprint("<p>Hello</p> ");
    expect(a).toBe(b);
  });
});
