import { describe, expect, it } from "vitest";
import { isStripeConnectAccountMissingError } from "./stripe-connect-account-gone";

describe("isStripeConnectAccountMissingError", () => {
  it("matches Stripe no such account messages", () => {
    expect(isStripeConnectAccountMissingError(new Error("No such account: 'acct_123'"))).toBe(true);
    expect(
      isStripeConnectAccountMissingError({
        code: "resource_missing",
        message: "No such account: 'acct_123'",
      })
    ).toBe(true);
  });

  it("does not treat generic invalid id / balance / other resource errors as account gone", () => {
    expect(isStripeConnectAccountMissingError(new Error("Invalid id"))).toBe(false);
    expect(isStripeConnectAccountMissingError(new Error("invalid id provided"))).toBe(false);
    expect(isStripeConnectAccountMissingError(new Error("No such customer: 'cus_1'"))).toBe(false);
    expect(isStripeConnectAccountMissingError(new Error("No such charge: 'ch_1'"))).toBe(false);
    expect(isStripeConnectAccountMissingError(new Error("Rate limit exceeded"))).toBe(false);
    expect(
      isStripeConnectAccountMissingError({
        code: "resource_missing",
        message: "No such customer: 'cus_1'",
      })
    ).toBe(false);
  });
});
