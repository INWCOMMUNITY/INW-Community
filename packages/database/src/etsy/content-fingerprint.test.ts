import { describe, expect, it } from "vitest";
import { etsyCentsFromMoney } from "./content-fingerprint";

describe("etsyCentsFromMoney", () => {
  it("parses numeric amount/divisor", () => {
    expect(etsyCentsFromMoney({ amount: 1250, divisor: 100 })).toBe(1250);
  });

  it("parses string amount/divisor from Etsy inventory JSON", () => {
    expect(etsyCentsFromMoney({ amount: "1500", divisor: "100" })).toBe(1500);
  });

  it("parses dollar string prices", () => {
    expect(etsyCentsFromMoney({ price: "12.50" })).toBe(1250);
  });
});
