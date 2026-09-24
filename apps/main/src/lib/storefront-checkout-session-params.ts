import type Stripe from "stripe";

/**
 * Tax + shipping address collection params for storefront Checkout Sessions.
 *
 * Buy It Now (`shippingCollectedByStripe`): Stripe collects shipping on Checkout.
 * With `automatic_tax` + an existing `customer`, Stripe requires
 * `customer_update.shipping = "auto"` so Tax can use the collected address
 * (docs: https://docs.stripe.com/tax/checkout).
 *
 * Cart/checkout with app-collected shipping: Customer.shipping is synced before
 * Session create; no `shipping_address_collection` / `customer_update`.
 */
export function storefrontCheckoutTaxShippingParams(opts: {
  deferShippingToStripe: boolean;
}): Pick<
  Stripe.Checkout.SessionCreateParams,
  "automatic_tax" | "billing_address_collection" | "shipping_address_collection" | "customer_update"
> {
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    ...(opts.deferShippingToStripe
      ? {
          shipping_address_collection: { allowed_countries: ["US"] as const },
          customer_update: { shipping: "auto" },
        }
      : {}),
  };
}

/**
 * Provider-mock style check that mirrors Stripe's validation rejection when
 * automatic tax + shipping collection lack `customer_update.shipping=auto`.
 * Returns a Stripe-shaped InvalidRequestError payload (deterministic / failed).
 */
export function validateStripeCheckoutTaxShippingCombo(
  params: Pick<
    Stripe.Checkout.SessionCreateParams,
    "automatic_tax" | "shipping_address_collection" | "customer_update" | "customer"
  >
): { ok: true } | { ok: false; error: { type: string; statusCode: number; message: string; code: string } } {
  const taxOn = params.automatic_tax?.enabled === true;
  const collectsShipping = Boolean(params.shipping_address_collection);
  const customerUpdateShipping = params.customer_update?.shipping;
  if (taxOn && collectsShipping && params.customer && customerUpdateShipping !== "auto") {
    return {
      ok: false,
      error: {
        type: "StripeInvalidRequestError",
        statusCode: 400,
        code: "parameter_missing",
        message:
          "You specified `shipping_address_collection`. To use `automatic_tax` with this parameter, you must also set `customer_update[shipping]` to `auto`.",
      },
    };
  }
  return { ok: true };
}
