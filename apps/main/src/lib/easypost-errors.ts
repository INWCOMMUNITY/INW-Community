/**
 * User-facing messages for EasyPost error codes (shipping context).
 * Fallback when we don't have custom handling. See EasyPost Errors docs.
 */
const EASYPOST_CODE_MESSAGES: Record<string, string> = {
  INTERNAL_SERVER_ERROR:
    "EasyPost had an issue. Please try again or contact support@easypost.com if it persists.",
  NOT_ACCEPTABLE:
    "The request could not be accepted. Please try again.",
  NOT_FOUND:
    "The requested resource was not found. Try getting rates again.",
  FORBIDDEN:
    "Unable to complete this action. Check your EasyPost account access.",
  PAYMENT_REQUIRED:
    "Insufficient funds in your EasyPost account. Check billing at https://app.easypost.com/account/settings?tab=billing.",
  UNAUTHORIZED:
    "EasyPost authorization failed. Check that your shipping account API key is correct in Seller Hub.",
  BAD_REQUEST:
    "Invalid request to EasyPost. Try getting rates again, then purchase the label.",
  "PAYMENT_GATEWAY.ERROR":
    "The payment processor could not handle the request. Please try again or contact support@easypost.com.",
  "MODE.UNAUTHORIZED":
    "This action requires a production EasyPost API key. Use a production key in Seller Hub.",
  "MODE.CONFLICT":
    "API key mode conflict. Use a production key for live labels.",
  "ADDRESS.PARAMETERS.INVALID":
    "Address data was missing or invalid. Check the shipping and return addresses.",
  "ADDRESS.COUNTRY.INVALID":
    "Invalid country code. Use a 2-character ISO code (e.g. US).",
  "ADDRESS.VERIFY.FAILURE":
    "The address could not be verified. Check street, city, state, and ZIP.",
  "ADDRESS.VERIFY.UNAVAILABLE":
    "Address verification is temporarily unavailable. Please try again.",
  "ADDRESS.VERIFY.MISSING_STREET":
    "A street is required for the address.",
  "ADDRESS.VERIFY.MISSING_CITY_STATE_ZIP":
    "City and state, or ZIP, are required for the address.",
  "ADDRESS.VERIFY.ONLY_US":
    "USPS can only validate US addresses.",
  "SHIPMENT.INVALID":
    "Not enough information to create the shipment. Try getting rates again.",
  "SHIPMENT.INVALID_PARAMS":
    "Invalid shipment parameters. Try getting rates again.",
  "SHIPMENT.PURCHASE.FAILURE":
    "Label purchase failed. Please try again or contact support@easypost.com.",
  "SHIPMENT.POSTAGE.FAILURE":
    "There was an error generating the label. Please try again or contact support@easypost.com.",
  "SHIPMENT.POSTAGE.NO_RESPONSE":
    "The carrier did not respond in time. Please try again or contact support@easypost.com.",
  "SHIPMENT.POSTAGE.TIMED_OUT":
    "The carrier timed out. Please try again or contact support@easypost.com.",
  "SHIPMENT.MISSING_RATE":
    "The rate is no longer valid. Please get rates again, then purchase the label.",
  "SHIPMENT.MISSING_INFORMATION":
    "Address or parcel information is missing. Try getting rates again.",
  "SHIPMENT.RATE.CARRIER_ACCOUNT_INVALID":
    "The rate is from an inactive carrier account. Get rates again and purchase a new label.",
  "SHIPMENT.RATES.UNAVAILABLE":
    "Rates could not be retrieved. Check address and parcel details.",
  "PARCEL.PARAMETERS.INVALID":
    "Parcel dimensions or weight are invalid. Check the values and try again.",
  "PARCEL.PREDEFINED_PACKAGE.INVALID":
    "The selected package type is invalid. Try another option.",
};

/**
 * Returns a user-facing message for an EasyPost error code, or the provided fallback (e.g. API message).
 */
export function getEasyPostUserMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  const mapped = EASYPOST_CODE_MESSAGES[code];
  return mapped ?? fallback;
}
