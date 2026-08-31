import { describe, expect, it } from "vitest";
import { expectedSellerTransferCents } from "./connect-payouts";

describe("expectedSellerTransferCents", () => {
  it("uses stored fee and reserve when present", () => {
    expect(
      expectedSellerTransferCents({
        totalCents: 1099,
        subtotalCents: 1000,
        platformFeeCents: 0,
        salesTaxReserveCents: 10,
      })
    ).toBe(1089);
  });

  it("falls back to 1% of item subtotal when fee fields are missing", () => {
    expect(expectedSellerTransferCents({ totalCents: 1000, subtotalCents: 1000 })).toBe(990);
  });
});
