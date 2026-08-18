import { describe, expect, it } from "vitest";
import {
  formatModerationErrorMessage,
  validateText,
} from "./content-moderation";

describe("validateText product_description", () => {
  it("allows USPS First Class shipping text (no ass substring false positive)", () => {
    const html =
      "<p>I will send in a small padded envelope through USPS First Class. Which will take about 2-3 days.</p>";
    expect(validateText(html, "product_description")).toEqual({ allowed: true });
  });

  it("allows coin listing title and description from eBay import pattern", () => {
    const title = "1952-D NGC MS 67 United States / American Jefferson Nickel";
    const desc =
      "<p>Up for sale-</p><p>1952-D NGC MS 67 United States / American Jefferson Nickel</p><p><b>Shipping Policy-</b></p><p>For coins, I will send USPS First Class.</p>";
    expect(validateText(title, "product_title")).toEqual({ allowed: true });
    expect(validateText(desc, "product_description")).toEqual({ allowed: true });
  });

  it("blocks whole-word profanity and reports matched words", () => {
    const result = validateText("This item is shit quality", "product_description");
    expect(result.allowed).toBe(false);
    expect(result.matchedWords).toContain("shit");
    expect(formatModerationErrorMessage(result)).toContain('"shit"');
  });

  it("does not block profanity embedded inside other words", () => {
    expect(validateText("Classic glass pass mass", "product_description")).toEqual({ allowed: true });
  });
});
