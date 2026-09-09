import { describe, expect, it } from "vitest";
import {
  comboInventoryFailedMessage,
  expectedComboSkuCount,
  shouldRebuildEtsyComboInventory,
} from "./combo-sync";

const sizeColor = {
  axes: [
    { name: "Size", values: ["S", "M"] },
    { name: "Color", values: ["Navy"] },
  ],
  skus: [
    { options: { Size: "S", Color: "Navy" }, quantity: 2 },
    { options: { Size: "M", Color: "Navy" }, quantity: 1 },
  ],
};

describe("shouldRebuildEtsyComboInventory", () => {
  it("rebuilds when remote is Color-only (one product per color) but INW has combos", () => {
    expect(shouldRebuildEtsyComboInventory(sizeColor, 1)).toBe(true);
    expect(expectedComboSkuCount(sizeColor)).toBe(2);
  });

  it("skips rebuild when remote already has one product per SKU", () => {
    expect(shouldRebuildEtsyComboInventory(sizeColor, 2)).toBe(false);
  });
});

describe("comboInventoryFailedMessage", () => {
  it("names the shop and Size × Color", () => {
    expect(comboInventoryFailedMessage("etsy")).toMatch(/Etsy/);
    expect(comboInventoryFailedMessage("etsy")).toMatch(/Size × Color/);
  });
});
