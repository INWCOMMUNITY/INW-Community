/**
 * User-facing messages for Shippo error codes (shipping context).
 */

const SHIPPO_CODE_MESSAGES: Record<string, string> = {
  UNAUTHORIZED:
    "Shippo authorization failed. Reconnect your shipping account in Seller Hub → Shipping.",
  FORBIDDEN:
    "Unable to complete this action. Check your Shippo account access.",
  NOT_FOUND:
    "The requested resource was not found. Try getting rates again.",
  BAD_REQUEST:
    "Invalid request to Shippo. Try getting rates again, then purchase the label.",
  RATE_LIMITED:
    "Shippo is temporarily limiting requests. Please try again in a few minutes.",
  PAYMENT_REQUIRED:
    "Payment issue with your Shippo account. Check billing in your Shippo dashboard.",
  ADDRESS_NOT_FOUND:
    "The address could not be verified. Check street, city, state, and ZIP.",
  INVALID_ADDRESS:
    "Address data was missing or invalid. Check the shipping and return addresses.",
  RATE_EXPIRED:
    "The rate is no longer valid. Please get rates again, then purchase the label.",
  CARRIER_TIMEOUT:
    "The carrier did not respond in time. Please try again.",
  CARRIER_ERROR:
    "The carrier could not process the request. Please try again or choose another service.",
};

/**
 * Returns a user-facing message for a Shippo error (detail string or code), or the provided fallback.
 */
export function getShippoUserMessage(detail: string | undefined, fallback: string): string {
  if (!detail) return fallback;
  const upper = detail.toUpperCase().replace(/\s+/g, "_");
  for (const [code, msg] of Object.entries(SHIPPO_CODE_MESSAGES)) {
    if (upper.includes(code)) return msg;
  }
  return fallback;
}
