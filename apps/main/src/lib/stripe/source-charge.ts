import type Stripe from "stripe";

/**
 * Resolve the Checkout PaymentIntent's Charge id for Connect `source_transaction`.
 * Same authority as Foundation seller payout: `paymentIntents.retrieve` + `latest_charge`.
 * Never returns a PaymentIntent id.
 */
export async function retrieveCheckoutChargeId(
  stripe: Stripe,
  paymentIntentId: string | null | undefined,
  log = "[source-charge]"
): Promise<string | null> {
  if (!paymentIntentId) return null;
  try {
    const piRetrieved = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const ch = piRetrieved.latest_charge;
    return typeof ch === "string"
      ? ch
      : ch && typeof ch === "object" && "id" in ch
        ? (ch as Stripe.Charge).id
        : null;
  } catch (piErr) {
    console.error(`${log} retrieve PI for Connect transfer:`, piErr);
    return null;
  }
}
