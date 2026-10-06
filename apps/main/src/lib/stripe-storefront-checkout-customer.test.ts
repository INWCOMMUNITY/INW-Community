import { describe, expect, it } from "vitest";
import { isNoSuchCustomerError } from "@/lib/stripe-storefront-checkout-customer";

describe("isNoSuchCustomerError", () => {
  it("matches Stripe missing-customer errors", () => {
    expect(isNoSuchCustomerError(new Error("No such customer: 'cus_UDMORmXtYzqzZu'"))).toBe(true);
    expect(isNoSuchCustomerError("No such customer: cus_abc")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isNoSuchCustomerError(new Error("card_declined"))).toBe(false);
  });
});
