import { describe, expect, it } from "vitest";
import { formatUsdFromCents, sumProrationLineCents } from "./legacy-business-price-credit";

describe("sumProrationLineCents", () => {
  it("adds unused-time credit and remaining-time charge from Stripe proration lines", () => {
    expect(
      sumProrationLineCents([
        { amount: -1250, proration: true },
        { amount: 500, proration: true },
        { amount: 1000, proration: false },
      ])
    ).toBe(-750);
  });

  it("ignores non-proration lines", () => {
    expect(sumProrationLineCents([{ amount: 2500, proration: false }])).toBe(0);
  });
});

describe("formatUsdFromCents", () => {
  it("formats dollars", () => {
    expect(formatUsdFromCents(-750)).toBe("-$7.50");
  });
});
