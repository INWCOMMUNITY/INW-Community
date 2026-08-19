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

export type EbayPolicyOption = { id: string; name: string; enabled?: boolean };

export type EbayPolicyOptions = {
  fulfillmentPolicies: EbayPolicyOption[];
  paymentPolicies: EbayPolicyOption[];
  returnPolicies: EbayPolicyOption[];
  merchantLocations: EbayPolicyOption[];
};

/** List all seller business policies and locations for the setup picker. */
export async function fetchEbayPolicyOptions(accessToken: string): Promise<EbayPolicyOptions> {
  const mp = EBAY_MARKETPLACE_ID;
  const [fulfillment, payment, ret, locations] = await Promise.all([
    safeGet<FulfillmentPolicyList>(accessToken, `/sell/account/v1/fulfillment_policy?marketplace_id=${mp}`),
    safeGet<PaymentPolicyList>(accessToken, `/sell/account/v1/payment_policy?marketplace_id=${mp}`),
    safeGet<ReturnPolicyList>(accessToken, `/sell/account/v1/return_policy?marketplace_id=${mp}`),
    safeGet<LocationList>(accessToken, `/sell/inventory/v1/location`),
  ]);

  return {
    fulfillmentPolicies: (fulfillment?.fulfillmentPolicies ?? [])
      .filter((p) => p.fulfillmentPolicyId)
      .map((p) => ({ id: p.fulfillmentPolicyId!, name: p.name ?? p.fulfillmentPolicyId! })),
    paymentPolicies: (payment?.paymentPolicies ?? [])
      .filter((p) => p.paymentPolicyId)
      .map((p) => ({ id: p.paymentPolicyId!, name: p.name ?? p.paymentPolicyId! })),
    returnPolicies: (ret?.returnPolicies ?? [])
      .filter((p) => p.returnPolicyId)
      .map((p) => ({ id: p.returnPolicyId!, name: p.name ?? p.returnPolicyId! })),
    merchantLocations: (locations?.locations ?? [])
      .filter((l) => l.merchantLocationKey)
      .map((l) => ({
        id: l.merchantLocationKey!,
        name: formatLocationName(l) ?? l.merchantLocationKey!,
        enabled: l.merchantLocationStatus === "ENABLED",
      })),
  };
}

/** Apply seller-selected policies onto a stored connection config. */
export function applyEbayPolicySelection(
  base: EbayConnectionConfig,
  selection: {
    fulfillmentPolicyId?: string | null;
    paymentPolicyId?: string | null;
    returnPolicyId?: string | null;
    merchantLocationKey?: string | null;
    fulfillmentPolicyName?: string | null;
    paymentPolicyName?: string | null;
    returnPolicyName?: string | null;
    merchantLocationName?: string | null;
    merchantLocationEnabled?: boolean;
  }
): EbayConnectionConfig {
  const next: EbayConnectionConfig = {
    ...base,
    fulfillmentPolicyId: selection.fulfillmentPolicyId ?? base.fulfillmentPolicyId,
    paymentPolicyId: selection.paymentPolicyId ?? base.paymentPolicyId,
    returnPolicyId: selection.returnPolicyId ?? base.returnPolicyId,
    merchantLocationKey: selection.merchantLocationKey ?? base.merchantLocationKey,
    fulfillmentPolicyName: selection.fulfillmentPolicyName ?? base.fulfillmentPolicyName,
    paymentPolicyName: selection.paymentPolicyName ?? base.paymentPolicyName,
    returnPolicyName: selection.returnPolicyName ?? base.returnPolicyName,
    merchantLocationName: selection.merchantLocationName ?? base.merchantLocationName,
    merchantLocationEnabled:
      selection.merchantLocationEnabled ?? base.merchantLocationEnabled,
  };
  next.canPublish = Boolean(
    next.sellingPolicyOptedIn &&
      next.fulfillmentPolicyId &&
      next.paymentPolicyId &&
      next.returnPolicyId &&
      next.merchantLocationKey &&
      next.merchantLocationEnabled
  );
  next.publishBlockReason = buildPublishBlockReason({
    sellingPolicyOptedIn: next.sellingPolicyOptedIn,
    fulfillmentPolicyId: next.fulfillmentPolicyId,
    paymentPolicyId: next.paymentPolicyId,
    returnPolicyId: next.returnPolicyId,
    merchantLocationKey: next.merchantLocationKey,
    locationEnabled: next.merchantLocationEnabled,
  });
  return next;
}

/** Opt-in helper for Seller Hub setup — creates a default merchant location when none exist. */
export async function createDefaultMerchantLocation(accessToken: string): Promise<string | null> {
  const key = `inw-default-${Date.now()}`.slice(0, 36);
  try {
    await ebayJson(
      accessToken,
      `/sell/inventory/v1/location/${encodeURIComponent(key)}`,
      "POST",
      {
        name: "INW Default Location",
        merchantLocationStatus: "ENABLED",
        locationTypes: ["WAREHOUSE"],
        location: {
          address: {
            city: "Spokane",
            stateOrProvince: "WA",
            country: "US",
            postalCode: "99201",
          },
        },
      },
      { contentLanguage: false }
    );
    return key;
  } catch (e) {
    console.warn("[ebay] createDefaultMerchantLocation failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Create simple default business policies for first-time eBay sellers. */
export async function createDefaultBusinessPolicies(
  accessToken: string
): Promise<Partial<EbayConnectionConfig>> {
  const mp = EBAY_MARKETPLACE_ID;
  const created: Partial<EbayConnectionConfig> = {};

  try {
    const fulfillment = await ebayJson<{ fulfillmentPolicyId?: string; name?: string }>(
      accessToken,
      `/sell/account/v1/fulfillment_policy`,
      "POST",
      {
        name: "INW Default Shipping",
        marketplaceId: mp,
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
        handlingTime: { value: 1, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                sortOrder: 1,
                shippingCarrierCode: "USPS",
                shippingServiceCode: "USPSPriorityFlatRateBox",
                shippingCost: { value: "0.00", currency: "USD" },
              },
            ],
          },
        ],
      },
      { contentLanguage: false }
    );
    created.fulfillmentPolicyId = fulfillment.fulfillmentPolicyId ?? null;
    created.fulfillmentPolicyName = fulfillment.name ?? "INW Default Shipping";
  } catch (e) {
    console.warn("[ebay] createDefaultBusinessPolicies fulfillment failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const payment = await ebayJson<{ paymentPolicyId?: string; name?: string }>(
      accessToken,
      `/sell/account/v1/payment_policy`,
      "POST",
      {
        name: "INW Default Payment",
        marketplaceId: mp,
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
        paymentMethods: [{ paymentMethodType: "PAYPAL" }],
      },
      { contentLanguage: false }
    );
    created.paymentPolicyId = payment.paymentPolicyId ?? null;
    created.paymentPolicyName = payment.name ?? "INW Default Payment";
  } catch (e) {
    console.warn("[ebay] createDefaultBusinessPolicies payment failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    const ret = await ebayJson<{ returnPolicyId?: string; name?: string }>(
      accessToken,
      `/sell/account/v1/return_policy`,
      "POST",
      {
        name: "INW Default Returns",
        marketplaceId: mp,
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        refundMethod: "MONEY_BACK",
        returnShippingCostPayer: "BUYER",
      },
      { contentLanguage: false }
    );
    created.returnPolicyId = ret.returnPolicyId ?? null;
    created.returnPolicyName = ret.name ?? "INW Default Returns";
  } catch (e) {
    console.warn("[ebay] createDefaultBusinessPolicies return failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return created;
}

export async function bootstrapDefaultEbayAccountSetup(
  accessToken: string,
  current: EbayConnectionConfig
): Promise<EbayConnectionConfig> {
  await optInToSellingPolicyManagement(accessToken);
  const options = await fetchEbayPolicyOptions(accessToken);
  let next = { ...current, sellingPolicyOptedIn: true };

  if (!next.merchantLocationKey) {
    const createdLocation = await createDefaultMerchantLocation(accessToken);
    if (createdLocation) {
      next = applyEbayPolicySelection(next, {
        merchantLocationKey: createdLocation,
        merchantLocationName: "INW Default Location",
        merchantLocationEnabled: true,
      });
    }
  }

  if (!next.fulfillmentPolicyId || !next.paymentPolicyId || !next.returnPolicyId) {
    const createdPolicies = await createDefaultBusinessPolicies(accessToken);
    next = applyEbayPolicySelection(next, createdPolicies);
  }

  if (!next.fulfillmentPolicyId && options.fulfillmentPolicies[0]) {
    next = applyEbayPolicySelection(next, {
      fulfillmentPolicyId: options.fulfillmentPolicies[0].id,
      fulfillmentPolicyName: options.fulfillmentPolicies[0].name,
    });
  }
  if (!next.paymentPolicyId && options.paymentPolicies[0]) {
    next = applyEbayPolicySelection(next, {
      paymentPolicyId: options.paymentPolicies[0].id,
      paymentPolicyName: options.paymentPolicies[0].name,
    });
  }
  if (!next.returnPolicyId && options.returnPolicies[0]) {
    next = applyEbayPolicySelection(next, {
      returnPolicyId: options.returnPolicies[0].id,
      returnPolicyName: options.returnPolicies[0].name,
    });
  }
  if (!next.merchantLocationKey && options.merchantLocations[0]) {
    next = applyEbayPolicySelection(next, {
      merchantLocationKey: options.merchantLocations[0].id,
      merchantLocationName: options.merchantLocations[0].name,
      merchantLocationEnabled: options.merchantLocations[0].enabled ?? false,
    });
  }

  return next;
}
