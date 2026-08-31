import { afterEach, describe, expect, it } from "vitest";
import {
  allocateTaxCentsAcrossOrders,
  assertPreTaxSplitMatchesOrderTotal,
  computeSalesTaxReserveCents,
  computeSellerTransferCents,
} from "./storefront-payout";

const FEE_PCT = "NWC_MARKETPLACE_PLATFORM_FEE_PERCENT";
const FEE_MIN = "NWC_MARKETPLACE_PLATFORM_FEE_MIN_CENTS";

afterEach(() => {
  delete process.env[FEE_PCT];
  delete process.env[FEE_MIN];
});

describe("computeSalesTaxReserveCents", () => {
  it("is 1% of item subtotal, floored", () => {
    expect(computeSalesTaxReserveCents(1000)).toBe(10);
    expect(computeSalesTaxReserveCents(199)).toBe(1);
    expect(computeSalesTaxReserveCents(0)).toBe(0);
  });
});

describe("computeSellerTransferCents", () => {
  it("withholds only the 1% reserve by default (no platform fee)", () => {
    expect(computeSellerTransferCents(1099, 1000)).toEqual({
      platformFeeCents: 0,
      salesTaxReserveCents: 10,
      sellerTransferCents: 1089,
    });
  });

  it("never transfers tax because tax is not part of order.totalCents", () => {
    const split = computeSellerTransferCents(1000, 1000);
    expect(split.platformFeeCents + split.salesTaxReserveCents + split.sellerTransferCents).toBe(
      1000
    );
  });
});

describe("assertPreTaxSplitMatchesOrderTotal", () => {
  it("accepts a split that consumes the pre-tax total", () => {
    const split = computeSellerTransferCents(1099, 1000);
    expect(() =>
      assertPreTaxSplitMatchesOrderTotal({ id: "o1", totalCents: 1099 }, split)
    ).not.toThrow();
  });
});

describe("allocateTaxCentsAcrossOrders", () => {
  it("allocates session tax by each order share of the pre-tax subtotal", () => {
    const map = allocateTaxCentsAcrossOrders(
      [
        { id: "a", totalCents: 600 },
        { id: "b", totalCents: 400 },
      ],
      1000,
      80
    );
    expect(map.get("a")).toBe(48);
    expect(map.get("b")).toBe(32);
  });

  it("puts remainder on the last order", () => {
    const map = allocateTaxCentsAcrossOrders(
      [
        { id: "a", totalCents: 1 },
        { id: "b", totalCents: 1 },
      ],
      2,
      1
    );
    expect((map.get("a") ?? 0) + (map.get("b") ?? 0)).toBe(1);
  });
});
