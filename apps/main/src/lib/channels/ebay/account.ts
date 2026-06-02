import { ebayGet } from "./client";
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
};

type FulfillmentPolicyList = { fulfillmentPolicies?: { fulfillmentPolicyId?: string }[] };
type PaymentPolicyList = { paymentPolicies?: { paymentPolicyId?: string }[] };
type ReturnPolicyList = { returnPolicies?: { returnPolicyId?: string }[] };
type LocationList = {
  locations?: { merchantLocationKey?: string; merchantLocationStatus?: string }[];
};

async function safeGet<T>(accessToken: string, path: string): Promise<T | null> {
  try {
    return await ebayGet<T>(accessToken, path);
  } catch {
    return null;
  }
}

/**
 * Detect the seller's default business policies + first merchant location. Missing pieces are
 * left null and `canPublish` is false so the adapter can create unpublished offers + warn.
 */
export async function fetchEbayConnectionConfig(
  accessToken: string
): Promise<EbayConnectionConfig> {
  const mp = EBAY_MARKETPLACE_ID;
  const [fulfillment, payment, ret, locations] = await Promise.all([
    safeGet<FulfillmentPolicyList>(accessToken, `/sell/account/v1/fulfillment_policy?marketplace_id=${mp}`),
    safeGet<PaymentPolicyList>(accessToken, `/sell/account/v1/payment_policy?marketplace_id=${mp}`),
    safeGet<ReturnPolicyList>(accessToken, `/sell/account/v1/return_policy?marketplace_id=${mp}`),
    safeGet<LocationList>(accessToken, `/sell/inventory/v1/location`),
  ]);

  const fulfillmentPolicyId = fulfillment?.fulfillmentPolicies?.[0]?.fulfillmentPolicyId ?? null;
  const paymentPolicyId = payment?.paymentPolicies?.[0]?.paymentPolicyId ?? null;
  const returnPolicyId = ret?.returnPolicies?.[0]?.returnPolicyId ?? null;
  const enabledLocation =
    locations?.locations?.find((l) => l.merchantLocationStatus === "ENABLED") ??
    locations?.locations?.[0];
  const merchantLocationKey = enabledLocation?.merchantLocationKey ?? null;

  return {
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    marketplaceId: mp,
    canPublish: Boolean(
      fulfillmentPolicyId && paymentPolicyId && returnPolicyId && merchantLocationKey
    ),
  };
}

/** Read eBay config off a connection's stored `config` blob with safe fallbacks. */
export function readEbayConfig(config: Record<string, unknown> | null): EbayConnectionConfig {
  const c = (config ?? {}) as Partial<EbayConnectionConfig>;
  const fulfillmentPolicyId = typeof c.fulfillmentPolicyId === "string" ? c.fulfillmentPolicyId : null;
  const paymentPolicyId = typeof c.paymentPolicyId === "string" ? c.paymentPolicyId : null;
  const returnPolicyId = typeof c.returnPolicyId === "string" ? c.returnPolicyId : null;
  const merchantLocationKey = typeof c.merchantLocationKey === "string" ? c.merchantLocationKey : null;
  return {
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
    merchantLocationKey,
    marketplaceId: typeof c.marketplaceId === "string" ? c.marketplaceId : EBAY_MARKETPLACE_ID,
    canPublish: Boolean(
      fulfillmentPolicyId && paymentPolicyId && returnPolicyId && merchantLocationKey
    ),
  };
}
