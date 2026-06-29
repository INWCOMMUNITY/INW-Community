import { ebayGet, ebayJson } from "./client";
import { EBAY_MARKETPLACE_ID } from "./config";

/**
 * eBay-specific connection config persisted on ChannelConnection.config. Publishing an offer
 * requires the three business policies + a merchant location; we auto-detect defaults at connect.
 */
export type EbayConnectionConfig = {
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
  marketplaceId: string;
  /** True when all of the above are present (i.e. listings can actually publish). */
  canPublish: boolean;
  /** True if the seller has opted into the Selling Policy Management program. */
  sellingPolicyOptedIn: boolean;
  /** If canPublish is false, this explains why (e.g. missing policies, no location). */
  publishBlockReason: string | null;
  /** Policy names for display in setup UI */
  fulfillmentPolicyName: string | null;
  paymentPolicyName: string | null;
  returnPolicyName: string | null;
  merchantLocationName: string | null;
  /** Whether the merchant location is enabled (not just exists) */
  merchantLocationEnabled: boolean;
};

type FulfillmentPolicy = { fulfillmentPolicyId?: string; name?: string };
type PaymentPolicy = { paymentPolicyId?: string; name?: string };
type ReturnPolicy = { returnPolicyId?: string; name?: string };
type MerchantLocation = {
  merchantLocationKey?: string;
  merchantLocationStatus?: string;
  name?: string;
  location?: { address?: { city?: string; stateOrProvince?: string } };
};

type FulfillmentPolicyList = { fulfillmentPolicies?: FulfillmentPolicy[] };
type PaymentPolicyList = { paymentPolicies?: PaymentPolicy[] };
type ReturnPolicyList = { returnPolicies?: ReturnPolicy[] };
type LocationList = { locations?: MerchantLocation[] };
type OptedInPrograms = {
  programs?: { programType?: string }[];
};

async function safeGet<T>(accessToken: string, path: string): Promise<T | null> {
  try {
    return await ebayGet<T>(accessToken, path);
  } catch {
    return null;
  }
}

/**
 * Check if the seller has opted into the Selling Policy Management program.
 * This is required before the Inventory API can publish listings.
 */
async function checkSellingPolicyOptIn(accessToken: string): Promise<boolean> {
  const programs = await safeGet<OptedInPrograms>(
    accessToken,
    "/sell/account/v1/program/get_opted_in_programs"
  );
  if (!programs?.programs) return false;
  return programs.programs.some((p) => p.programType === "SELLING_POLICY_MANAGEMENT");
}

/**
 * Attempt to opt the seller into the Selling Policy Management program.
 * Returns true if successful (or already opted in), false if it failed.
 */
export async function optInToSellingPolicyManagement(accessToken: string): Promise<boolean> {
  // First check if already opted in
  const alreadyOptedIn = await checkSellingPolicyOptIn(accessToken);
  if (alreadyOptedIn) return true;

  try {
    await ebayJson(
      accessToken,
      "/sell/account/v1/program/opt_in",
      "POST",
      { programType: "SELLING_POLICY_MANAGEMENT" },
      { contentLanguage: false }
    );
    // eBay says opt-in can take up to 24 hours to process, but usually it's immediate
    return true;
  } catch (e) {
    console.warn("[ebay] Failed to opt into Selling Policy Management", e);
    return false;
  }
}

/**
 * Build a human-readable reason explaining why publishing is blocked.
 */
function buildPublishBlockReason(args: {
  sellingPolicyOptedIn: boolean;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  merchantLocationKey: string | null;
  locationEnabled: boolean;
}): string | null {
  const missing: string[] = [];

  if (!args.sellingPolicyOptedIn) {
    missing.push("seller not opted into Business Policies program");
  }
  if (!args.fulfillmentPolicyId) {
    missing.push("no shipping/fulfillment policy");
  }
  if (!args.paymentPolicyId) {
    missing.push("no payment policy");
  }
  if (!args.returnPolicyId) {
    missing.push("no return policy");
  }
  if (!args.merchantLocationKey) {
    missing.push("no merchant location configured");
  } else if (!args.locationEnabled) {
    missing.push("merchant location is not ENABLED");
  }

  if (missing.length === 0) return null;
  return `Cannot publish: ${missing.join(", ")}. Set these up in eBay Seller Hub.`;
}

/** Build a display name for a merchant location */
function formatLocationName(loc: MerchantLocation | undefined): string | null {
  if (!loc) return null;
  if (loc.name) return loc.name;
  const city = loc.location?.address?.city;
  const state = loc.location?.address?.stateOrProvince;
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  return loc.merchantLocationKey ?? null;
}

/**
 * Detect the seller's default business policies + first merchant location. Missing pieces are
 * left null and `canPublish` is false so the adapter can create unpublished offers + warn.
 */
export async function fetchEbayConnectionConfig(
  accessToken: string
): Promise<EbayConnectionConfig> {
  const mp = EBAY_MARKETPLACE_ID;

  // Check opt-in status and fetch policies/locations in parallel
  const [sellingPolicyOptedIn, fulfillment, payment, ret, locations] = await Promise.all([
    checkSellingPolicyOptIn(accessToken),
    safeGet<FulfillmentPolicyList>(accessToken, `/sell/account/v1/fulfillment_policy?marketplace_id=${mp}`),
    safeGet<PaymentPolicyList>(accessToken, `/sell/account/v1/payment_policy?marketplace_id=${mp}`),
    safeGet<ReturnPolicyList>(accessToken, `/sell/account/v1/return_policy?marketplace_id=${mp}`),
    safeGet<LocationList>(accessToken, `/sell/inventory/v1/location`),
  ]);

  // Extract first policy of each type with ID and name
  const fulfillmentPolicy = fulfillment?.fulfillmentPolicies?.[0];
  const paymentPolicy = payment?.paymentPolicies?.[0];
  const returnPolicy = ret?.returnPolicies?.[0];

  const fulfillmentPolicyId = fulfillmentPolicy?.fulfillmentPolicyId ?? null;
  const paymentPolicyId = paymentPolicy?.paymentPolicyId ?? null;
  const returnPolicyId = returnPolicy?.returnPolicyId ?? null;

  const fulfillmentPolicyName = fulfillmentPolicy?.name ?? null;
  const paymentPolicyName = paymentPolicy?.name ?? null;
  const returnPolicyName = returnPolicy?.name ?? null;

  // Find an ENABLED location; fall back to first location but mark it as not enabled
  const enabledLocation = locations?.locations?.find((l) => l.merchantLocationStatus === "ENABLED");
  const fallbackLocation = locations?.locations?.[0];
  const selectedLocation = enabledLocation ?? fallbackLocation;
  const merchantLocationKey = selectedLocation?.merchantLocationKey ?? null;
  const merchantLocationEnabled = !!enabledLocation;
  const merchantLocationName = formatLocationName(selectedLocation);

  const canPublish = Boolean(
    sellingPolicyOptedIn &&
    fulfillmentPolicyId &&
    paymentPolicyId &&
    returnPolicyId &&
    merchantLocationKey &&
    merchantLocationEnabled
  );

  const publishBlockReason = buildPublishBlockReason({
    sellingPolicyOptedIn,
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    locationEnabled: merchantLocationEnabled,
  });

  return {
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    marketplaceId: mp,
    canPublish,
    sellingPolicyOptedIn,
    publishBlockReason,
    fulfillmentPolicyName,
    paymentPolicyName,
    returnPolicyName,
    merchantLocationName,
    merchantLocationEnabled,
  };
}

/** Read eBay config off a connection's stored `config` blob with safe fallbacks. */
export function readEbayConfig(config: Record<string, unknown> | null): EbayConnectionConfig {
  const c = (config ?? {}) as Partial<EbayConnectionConfig>;
  const fulfillmentPolicyId = typeof c.fulfillmentPolicyId === "string" ? c.fulfillmentPolicyId : null;
  const paymentPolicyId = typeof c.paymentPolicyId === "string" ? c.paymentPolicyId : null;
  const returnPolicyId = typeof c.returnPolicyId === "string" ? c.returnPolicyId : null;
  const merchantLocationKey = typeof c.merchantLocationKey === "string" ? c.merchantLocationKey : null;
  // Default to true for backwards compatibility with existing connections
  const sellingPolicyOptedIn = typeof c.sellingPolicyOptedIn === "boolean" ? c.sellingPolicyOptedIn : true;
  const publishBlockReason = typeof c.publishBlockReason === "string" ? c.publishBlockReason : null;
  // Policy and location names for display
  const fulfillmentPolicyName = typeof c.fulfillmentPolicyName === "string" ? c.fulfillmentPolicyName : null;
  const paymentPolicyName = typeof c.paymentPolicyName === "string" ? c.paymentPolicyName : null;
  const returnPolicyName = typeof c.returnPolicyName === "string" ? c.returnPolicyName : null;
  const merchantLocationName = typeof c.merchantLocationName === "string" ? c.merchantLocationName : null;
  // Default to true for backwards compatibility (assume enabled if key exists)
  const merchantLocationEnabled = typeof c.merchantLocationEnabled === "boolean" ? c.merchantLocationEnabled : !!merchantLocationKey;

  return {
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    marketplaceId: typeof c.marketplaceId === "string" ? c.marketplaceId : EBAY_MARKETPLACE_ID,
    canPublish: Boolean(
      sellingPolicyOptedIn &&
      fulfillmentPolicyId &&
      paymentPolicyId &&
      returnPolicyId &&
      merchantLocationKey &&
      merchantLocationEnabled
    ),
    sellingPolicyOptedIn,
    publishBlockReason,
    fulfillmentPolicyName,
    paymentPolicyName,
    returnPolicyName,
    merchantLocationName,
    merchantLocationEnabled,
  };
}
