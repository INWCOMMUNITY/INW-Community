import { describe, expect, it } from "vitest";
import { isShopifySaleOrder } from "./sale-order";

describe("isShopifySaleOrder", () => {
  it("decrements paid / authorized orders", () => {
    expect(isShopifySaleOrder({ financial_status: "paid" })).toBe(true);
    expect(isShopifySaleOrder({ financial_status: "authorized" })).toBe(true);
    expect(isShopifySaleOrder({ financial_status: "partially_paid" })).toBe(true);
  });

  it("does not decrement unpaid, cancelled, or refunded orders", () => {
    expect(isShopifySaleOrder({ financial_status: "pending" })).toBe(false);
    expect(isShopifySaleOrder({ financial_status: "paid", cancelled_at: "2026-01-01" })).toBe(false);
    expect(isShopifySaleOrder({ financial_status: "voided" })).toBe(false);
    expect(isShopifySaleOrder({ financial_status: "refunded" })).toBe(false);
  });
});
