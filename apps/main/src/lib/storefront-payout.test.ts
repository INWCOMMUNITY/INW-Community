import { afterEach, describe, expect, it } from "vitest";
import {
  allocateTaxCentsAcrossOrders,
  assertPreTaxSplitMatchesOrderTotal,
  computeSalesTaxReserveCents,
  computeSellerTransferCents,
  computeStripeProcessingFeeCents,
  computeStripeTaxProductFeeCents,
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

describe("computeStripeProcessingFeeCents", () => {
  it("is 2.9% floored plus 30 cents", () => {
    expect(computeStripeProcessingFeeCents(1000)).toBe(59); // 29 + 30
    expect(computeStripeProcessingFeeCents(0)).toBe(0);
  });
});

describe("computeStripeTaxProductFeeCents", () => {
  it("is 0.5% of charge when tax was collected, else 0", () => {
    expect(computeStripeTaxProductFeeCents(1060, 60)).toBe(5); // floor(1060*0.005)
    expect(computeStripeTaxProductFeeCents(1000, 0)).toBe(0);
    expect(computeStripeTaxProductFeeCents(199, 12)).toBe(0); // floor(0.995)=0
  });
});

describe("computeSellerTransferCents", () => {
  it("withholds 1% reserve and card processing from the seller (no optional platform fee)", () => {
    expect(computeSellerTransferCents(1099, 1000, 0)).toEqual({
      optionalPlatformFeeCents: 0,
      processingFeeCents: 61, // floor(1099*0.029)+30
      stripeTaxProductFeeCents: 0,
      platformFeeCents: 61,
      salesTaxReserveCents: 10,
      sellerTransferCents: 1028,
    });
  });

  it("includes tax in the processing fee base but not in the transfer", () => {
    const split = computeSellerTransferCents(1000, 1000, 80);
    expect(split.processingFeeCents).toBe(computeStripeProcessingFeeCents(1080));
    expect(split.stripeTaxProductFeeCents).toBe(computeStripeTaxProductFeeCents(1080, 80));
    expect(split.platformFeeCents + split.salesTaxReserveCents + split.sellerTransferCents).toBe(1000);
  });

  it("withholds Stripe Tax product fee when sales tax is collected", () => {
    // $10 item + $0.80 tax → charge 1080; tax product fee floor(1080*0.005)=5
    const split = computeSellerTransferCents(1000, 1000, 80);
    expect(split.stripeTaxProductFeeCents).toBe(5);
    expect(split.processingFeeCents).toBe(61); // floor(1080*0.029)+30
    expect(split.salesTaxReserveCents).toBe(10);
    expect(split.sellerTransferCents).toBe(1000 - 61 - 5 - 10);
  });
});

describe("assertPreTaxSplitMatchesOrderTotal", () => {
  it("accepts a split that consumes the pre-tax total", () => {
    const split = computeSellerTransferCents(1099, 1000, 0);
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
