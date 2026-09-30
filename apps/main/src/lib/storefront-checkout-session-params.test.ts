import { describe, expect, it } from "vitest";
import {
  classifyStripeSessionCreateFailure,
  stripeCheckoutRequestOptions,
} from "database";
import {
  storefrontCheckoutTaxShippingParams,
  validateStripeCheckoutTaxShippingCombo,
} from "@/lib/storefront-checkout-session-params";

describe("storefront checkout tax + shipping Session params", () => {
  it("A: Stripe-collected shipping + automatic tax includes customer_update.shipping=auto", () => {
    const params = {
      customer: "cus_test",
      ...storefrontCheckoutTaxShippingParams({ deferShippingToStripe: true }),
    };
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.shipping_address_collection).toEqual({ allowed_countries: ["US"] });
    expect(params.customer_update).toEqual({ shipping: "auto" });
    expect(validateStripeCheckoutTaxShippingCombo(params)).toEqual({ ok: true });
  });

  it("B: explicit pre-collected shipping keeps automatic_tax without shipping_address_collection", () => {
    const params = {
      customer: "cus_test",
      ...storefrontCheckoutTaxShippingParams({ deferShippingToStripe: false }),
    };
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.billing_address_collection).toBe("required");
    expect(params.shipping_address_collection).toBeUndefined();
    expect(params.customer_update).toBeUndefined();
    expect(validateStripeCheckoutTaxShippingCombo(params)).toEqual({ ok: true });
  });

  it("C: missing customer_update.shipping fails deterministically (not SESSION_UNKNOWN)", () => {
    const legacyBroken = {
      customer: "cus_test",
      automatic_tax: { enabled: true as const },
      shipping_address_collection: { allowed_countries: ["US" as const] },
      // intentionally omit customer_update — pre-fix production defect
    };
    const validation = validateStripeCheckoutTaxShippingCombo(legacyBroken);
    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("expected validation failure");
    expect(validation.error.type).toBe("StripeInvalidRequestError");
    expect(validation.error.statusCode).toBe(400);
    expect(validation.error.message).toMatch(/customer_update\[shipping\].*auto/i);
    // Deterministic provider rejection → attempt fail + release, not SESSION_UNKNOWN
    expect(classifyStripeSessionCreateFailure(validation.error)).toBe("failed");
  });

  it("D: same logical attempt keeps stable Stripe idempotency key", () => {
    const attempt = { stripeIdempotencyKey: "cko_idem_attempt_abc123" };
    const first = stripeCheckoutRequestOptions(attempt);
    const retry = stripeCheckoutRequestOptions(attempt);
    expect(first.idempotencyKey).toBe("cko_idem_attempt_abc123");
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(classifyStripeSessionCreateFailure({ type: "StripeConnectionError" })).toBe("unknown");
  });

  it("E: reservation cleanup path is correct for deterministic Stripe rejection", () => {
    const stripeReject = {
      type: "StripeInvalidRequestError",
      statusCode: 400,
      code: "parameter_missing",
      message:
        "You specified `shipping_address_collection`. To use `automatic_tax` with this parameter, you must also set `customer_update[shipping]` to `auto`.",
    };
    expect(classifyStripeSessionCreateFailure(stripeReject)).toBe("failed");
    // uncertain outcomes must remain unknown (Prompt 149)
    expect(
      classifyStripeSessionCreateFailure({ type: "StripeAPIError", statusCode: 500 })
    ).toBe("unknown");
    expect(
      classifyStripeSessionCreateFailure({ type: "StripeIdempotencyError" })
    ).toBe("unknown");
  });
});
