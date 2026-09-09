import { describe, expect, it } from "vitest";
import { applyLegacyPresetRemap } from "./repair-categories";

describe("applyLegacyPresetRemap", () => {
  it("moves Books Video Games to Video Games & Consoles", () => {
    expect(applyLegacyPresetRemap("Books, Movies & Music", "Video Games")).toEqual({
      category: "Video Games & Consoles",
      subcategory: "Games (physical)",
    });
  });

  it("moves Toys physical video games to Video Games & Consoles", () => {
    expect(applyLegacyPresetRemap("Toys & Games", "Video Games (physical)")).toEqual({
      category: "Video Games & Consoles",
      subcategory: "Games (physical)",
    });
  });

  it("moves Home food leaves to Food & Drink", () => {
    expect(applyLegacyPresetRemap("Home & Kitchen", "Food & Drink")).toEqual({
      category: "Food & Drink",
      subcategory: "Pantry & Packaged",
    });
    expect(applyLegacyPresetRemap("Home & Living", "Food & Drink (home)")).toEqual({
      category: "Food & Drink",
      subcategory: "Other Food & Drink",
    });
  });

  it("leaves unrelated presets alone", () => {
    expect(applyLegacyPresetRemap("Home & Kitchen", "Coffee & Tea")).toBeNull();
  });
});
