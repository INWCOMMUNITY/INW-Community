/**
 * Extended error classifier registry for sync trace root cause analysis.
 * 
 * These classifiers analyze SyncTrace context to provide detailed, actionable
 * root cause explanations for known error patterns.
 */

import { registerTraceClassifier, type TraceClassifier, type SyncTraceContext } from "./sync-trace";

function preparedAspectNames(ctx: SyncTraceContext): string[] {
  const after = ctx.transformTrace?.after?.aspects;
  if (!Array.isArray(after)) return [];
  return after
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const name = (row as { name?: unknown }).name;
      return typeof name === "string" ? name.trim() : "";
    })
    .filter(Boolean);
}

function analyzeEbayAspectMismatch(ctx: SyncTraceContext): string | null {
  if (ctx.transformTrace?.before && (ctx.transformTrace.before as Record<string, unknown>).passthrough) {
    return null;
  }
  const uploaded = !!ctx.requestPayload;
  const sentAspects = uploaded
    ? Object.keys((ctx.requestPayload?.product as Record<string, unknown>)?.aspects || {})
    : preparedAspectNames(ctx);
  const expectedNames = ctx.transformTrace?.categorySchema?.map((a) => a.name) || [];
  const requiredNames =
    ctx.transformTrace?.categorySchema?.filter((a) => a.required).map((a) => a.name) || [];

  const issues: string[] = [];

  const unrecognized = sentAspects.filter(
    (k) => !expectedNames.some((e) => e.toLowerCase() === k.toLowerCase())
  );
  if (unrecognized.length > 0) {
    issues.push(`Unrecognized aspect keys: ${unrecognized.slice(0, 5).join(", ")}`);
  }

  const missingRequired = requiredNames.filter(
    (r) => !sentAspects.some((s) => s.toLowerCase() === r.toLowerCase())
  );
  if (missingRequired.length > 0) {
    issues.push(`Missing required aspects: ${missingRequired.slice(0, 5).join(", ")}`);
  }

  const dropped = ctx.transformTrace?.dropped || [];
  if (dropped.length > 0) {
    issues.push(`Aspects dropped during remap (not in taxonomy): ${dropped.slice(0, 5).join(", ")}`);
  }

  if (issues.length === 0) return null;

  if (!uploaded) {
    const inputCount = Array.isArray(ctx.inputSnapshot?.aspects)
      ? (ctx.inputSnapshot!.aspects as unknown[]).length
      : 0;
    return (
      `Blocked before eBay upload: ${issues.join(". ")}. ` +
      `Stored ${inputCount} specifics, prepared ${sentAspects.length} for category ${ctx.categoryId ?? "unknown"}. ` +
      `Save the listing and ensure Year is filled under eBay Listing Requirements.`
    );
  }

  return `eBay #25064: ${issues.join(". ")}. Edit the listing under "eBay Listing Requirements" to fix.`;
}
/**
 * eBay-specific error classifiers
 */
const EBAY_CLASSIFIERS: TraceClassifier[] = [
  {
    id: "ebay_inventory_sync_failed",
    provider: "ebay",
    pattern: /inventory verify|bulk_update_price_quantity|quantity didn't update|availableQuantity/i,
    category: "inventory_sync_failed",
    analyze: () =>
      "Quantity didn't update on eBay. Try Sync now from the listing page. If it persists, check eBay Seller Hub for listing status.",
  },
  {
    id: "ebay_content_sync_failed",
    provider: "ebay",
    pattern: /content updated but publish failed|title.*long|photo.*required|listingDescription/i,
    category: "content_sync_failed",
    analyze: () =>
      "Title, price, photos, or description didn't fully sync to eBay. Save the listing and try Sync now.",
  },
  {
    id: "ebay_25064_aspect_mismatch",
    provider: "ebay",
    pattern: /#25064|item specific|required field.*aspect|aspect.*required/i,
    category: "aspect_mismatch",
    analyze: analyzeEbayAspectMismatch,
  },
  {
    id: "ebay_25021_condition_mismatch",
    provider: "ebay",
    pattern: /#25021|condition.*invalid|invalid.*condition|item condition/i,
    category: "condition_invalid",
    analyze: (ctx) => {
      const sentCondition = (ctx.requestPayload as Record<string, unknown>)?.condition;
      const categoryId = ctx.categoryId;
      
      if (sentCondition && categoryId) {
        return `eBay #25021: Condition "${sentCondition}" is not valid for category ${categoryId}. ` +
          `Go to the listing and select a valid condition from the eBay Condition dropdown.`;
      }
      return `eBay #25021: Item condition is not valid for this category. Update the condition in the listing.`;
    },
  },
  {
    id: "ebay_policy_missing",
    provider: "ebay",
    pattern: /policy.*required|fulfillment.*policy|return.*policy|payment.*policy|business.?policies/i,
    category: "policy_missing",
    analyze: () => {
      return "eBay business policies are not configured. Go to Seller Hub > Sync Stores > eBay and select your fulfillment, return, and payment policies.";
    },
  },
  {
    id: "ebay_merchant_location",
    provider: "ebay",
    pattern: /merchant.?location|location.*required|inventory.?location/i,
    category: "merchant_location_missing",
    analyze: () => {
      return "eBay merchant location is not configured. Go to your eBay Seller Hub and create an inventory location, then reconnect in Sync Stores.";
    },
  },
  {
    id: "ebay_picture_resolution",
    provider: "ebay",
    pattern: /500 pixels|longest side|Picture Policy|resolution for provided picture/i,
    category: "photo_missing",
    analyze: () =>
      "eBay requires each photo to be at least 500 pixels on the longest side. Gallery thumbs cannot be used. If a photo file is itself smaller than 500px, replace it on the listing.",
  },
  {
    id: "ebay_variation_information",
    provider: "ebay",
    pattern: /variationInformation|#25002.*variation/i,
    category: "sku_conflict",
    analyze: () =>
      "INW generates a unique SKU for each variation when it pushes to eBay. Retry sync so the listing is updated as a variation group.",
  },
  {
    id: "ebay_category_invalid",
    provider: "ebay",
    pattern: /category.*invalid|invalid.*category|#25002/i,
    category: "category_invalid",
    analyze: (ctx) => {
      const categoryId = ctx.categoryId;
      return categoryId
        ? `eBay category ${categoryId} is invalid or no longer available. Select a different eBay category for this listing.`
        : "No eBay category selected. Edit the listing and choose an eBay category.";
    },
  },
  {
    id: "ebay_sku_exists",
    provider: "ebay",
    pattern: /sku.*exist|duplicate.*sku|#25025/i,
    category: "sku_conflict",
    analyze: (ctx) => {
      return `SKU "${ctx.sku}" already exists in your eBay inventory. Either delete the existing eBay listing or change this item's SKU.`;
    },
  },
  {
    id: "ebay_revision_limit",
    provider: "ebay",
    pattern: /revision.*limit|#21917|too many.*updates/i,
    category: "rate_limit",
    analyze: (ctx) => {
      return `eBay revision limit reached for SKU "${ctx.sku}". eBay allows 250 updates per day per listing. Wait until tomorrow or reduce update frequency.`;
    },
  },
  {
    id: "ebay_photo_required",
    provider: "ebay",
    pattern: /image.*required|photo.*required|picture.*required/i,
    category: "photo_missing",
    analyze: () => {
      return "eBay requires at least one photo. Add a photo to this listing before syncing.";
    },
  },
  {
    id: "ebay_title_length",
    provider: "ebay",
    pattern: /title.*long|title.*exceed|#21919/i,
    category: "title_invalid",
    analyze: () => {
      return "Title exceeds eBay's 80-character limit. Shorten the title in the listing.";
    },
  },
  {
    id: "ebay_price_invalid",
    provider: "ebay",
    pattern: /price.*invalid|#21916|minimum.*price/i,
    category: "price_invalid",
    analyze: (ctx) => {
      const price = (ctx.inputSnapshot as Record<string, unknown>)?.priceCents;
      if (typeof price === "number" && price < 100) {
        return `Price $${(price / 100).toFixed(2)} is below eBay's minimum. eBay requires a minimum price of $0.99.`;
      }
      return "Price is invalid for eBay. Check that the price is at least $0.99.";
    },
  },
];

/**
 * Etsy-specific error classifiers
 */
const ETSY_CLASSIFIERS: TraceClassifier[] = [
  {
    id: "etsy_invalid_marketplace",
    provider: "etsy",
    pattern: /invalid_marketplace|cannot sell this item on Etsy/i,
    category: "listing_prohibited",
    analyze: () =>
      "Etsy will not list this item (prohibited category or marketplace rules). Pick a different Etsy category in Needs Attention, or skip Etsy for this listing.",
  },
  {
    id: "etsy_taxonomy_invalid",
    provider: "etsy",
    pattern: /taxonomy.*invalid|category.*invalid|#1044|#1002/i,
    category: "taxonomy_invalid",
    analyze: (ctx) => {
      const taxonomyId = (ctx.inputSnapshot as Record<string, unknown>)?.etsyTaxonomyId;
      if (taxonomyId) {
        return `Etsy taxonomy ID ${taxonomyId} is invalid or deprecated. Edit the listing and select a different Etsy category.`;
      }
      return "Etsy taxonomy/category is required. Edit the listing and select an Etsy category.";
    },
  },
  {
    id: "etsy_calculated_shipping_package",
    provider: "etsy",
    pattern: /calculated shipping profile|item_weight|item_dimensions_unit/i,
    category: "shipping_package_missing",
    analyze: () => {
      return "Etsy calculated shipping needs package weight and size. Edit the listing on Etsy if the default package size is wrong.";
    },
  },
  {
    id: "etsy_shipping_profile_missing",
    provider: "etsy",
    pattern: /shipping.*profile|profile.*required|#1005/i,
    category: "shipping_missing",
    analyze: () => {
      return "Etsy shipping profile is not configured. Go to your Etsy Shop Manager > Shipping Settings and create a shipping profile, then reconnect in Sync Stores.";
    },
  },
  {
    id: "etsy_who_made_required",
    provider: "etsy",
    pattern: /who_made.*required|who made|#1003/i,
    category: "field_missing",
    analyze: () => {
      return "'Who made it?' is required for Etsy. Open Sync Stores → Needs Attention and fill who made it, when, and whether this is a supply.";
    },
  },
  {
    id: "etsy_origin_trio",
    provider: "etsy",
    pattern: /when_made.*who_made.*is_supply|without 'is_supply'/i,
    category: "field_missing",
    analyze: () => {
      return "Etsy needs who made it, when it was made, and whether this is a supply together. Open Sync Stores → Needs Attention and save those fields.";
    },
  },
  {
    id: "etsy_when_made_required",
    provider: "etsy",
    pattern: /when_made.*required|when made|#1004/i,
    category: "field_missing",
    analyze: () => {
      return "'When was it made?' is required for Etsy. Edit the listing and select when this item was made.";
    },
  },
  {
    id: "etsy_listing_not_found",
    provider: "etsy",
    pattern: /listing.*not.*found|#1001|404/i,
    category: "listing_not_found",
    analyze: (ctx) => {
      return `Etsy listing not found. The listing may have been deleted directly on Etsy. Unlink this item from Etsy and re-publish to create a new listing.`;
    },
  },
  {
    id: "etsy_photo_required",
    provider: "etsy",
    pattern: /image.*required|photo.*required|#1006/i,
    category: "photo_missing",
    analyze: () => {
      return "Etsy requires at least one photo. Add a photo to this listing before syncing.";
    },
  },
  {
    id: "etsy_title_all_caps",
    provider: "etsy",
    pattern: /all_caps|sequential capital/i,
    category: "title_invalid",
    analyze: () => {
      return "Etsy rejected the title for too many all-caps words. Retry listing on Etsy — extra ALL-CAPS words are now converted automatically.";
    },
  },
  {
    id: "etsy_title_length",
    provider: "etsy",
    pattern: /title.*long|title.*exceed|#1008/i,
    category: "title_invalid",
    analyze: () => {
      return "Title exceeds Etsy's 140-character limit. Shorten the title in the listing.";
    },
  },
  {
    id: "etsy_shops_w_scope",
    provider: "etsy",
    pattern: /shops_w|lacks scope for this request/i,
    category: "permission_denied",
    analyze: () => {
      return "Etsy needs the shops_w permission to create shipping profiles. Reconnect Etsy in Sync Stores, then retry. Listings can still use an existing shipping profile in your Etsy shop.";
    },
  },
  {
    id: "etsy_description_length",
    provider: "etsy",
    pattern: /description.*long|description.*exceed/i,
    category: "description_invalid",
    analyze: () => {
      return "Description is too long for Etsy. Shorten the description in the listing.";
    },
  },
  {
    id: "etsy_shop_inactive",
    provider: "etsy",
    pattern: /shop.*inactive|shop.*vacation|shop.*closed/i,
    category: "shop_inactive",
    analyze: () => {
      return "Your Etsy shop is inactive or in vacation mode. Reactivate your shop on Etsy before syncing.";
    },
  },
  {
    id: "etsy_processing_profile",
    provider: "etsy",
    pattern: /readiness.?state|processing.*profile|#1010/i,
    category: "processing_profile_missing",
    analyze: () => {
      return "Etsy processing time profile is missing. Go to your Etsy Shop Manager and set up a processing profile.";
    },
  },
];

/**
 * Generic error classifiers (apply to all providers)
 */
const GENERIC_CLASSIFIERS: TraceClassifier[] = [
  {
    id: "auth_token_expired",
    provider: "*",
    pattern: /\b401\b|unauthorized|token.*expired|invalid.*token|authentication.*failed/i,
    category: "auth_expired",
    analyze: (ctx) => {
      const providerName = ctx.provider.charAt(0).toUpperCase() + ctx.provider.slice(1);
      return `${providerName} access token has expired or is invalid. Go to Seller Hub > Sync Stores and reconnect your ${providerName} account.`;
    },
  },
  {
    id: "rate_limit_exceeded",
    provider: "*",
    pattern: /\b429\b|rate.?limit|too many requests|quota.*exceeded/i,
    category: "rate_limit",
    analyze: (ctx) => {
      const providerName = ctx.provider.charAt(0).toUpperCase() + ctx.provider.slice(1);
      return `${providerName} API rate limit exceeded. The system will automatically retry later. If this persists, reduce how often you update listings.`;
    },
  },
  {
    id: "network_error",
    provider: "*",
    pattern: /econnreset|enotfound|etimedout|network.*error|connection.*refused/i,
    category: "network_error",
    analyze: (ctx) => {
      const providerName = ctx.provider.charAt(0).toUpperCase() + ctx.provider.slice(1);
      return `Network error connecting to ${providerName}. This is usually temporary - the system will retry automatically.`;
    },
  },
  {
    id: "server_error",
    provider: "*",
    pattern: /\b5\d{2}\b|internal.*server.*error|service.*unavailable/i,
    category: "channel_unavailable",
    analyze: (ctx) => {
      const providerName = ctx.provider.charAt(0).toUpperCase() + ctx.provider.slice(1);
      return `${providerName} is experiencing server issues (HTTP 5xx). This is a temporary problem on their end - the system will retry automatically.`;
    },
  },
  {
    id: "permission_denied",
    provider: "*",
    pattern: /\b403\b|forbidden|permission.*denied|access.*denied/i,
    category: "permission_denied",
    analyze: (ctx) => {
      const providerName = ctx.provider.charAt(0).toUpperCase() + ctx.provider.slice(1);
      return `Permission denied by ${providerName}. Your account may need additional permissions. Try reconnecting your ${providerName} account in Sync Stores.`;
    },
  },
];

/**
 * Register all extended classifiers with the sync-trace module.
 * Called lazily from sync-trace when classifying errors.
 */
export function registerAllClassifiers(): void {
  for (const classifier of [...EBAY_CLASSIFIERS, ...ETSY_CLASSIFIERS, ...GENERIC_CLASSIFIERS]) {
    registerTraceClassifier(classifier);
  }
}

/**
 * Get suggested fixes for a specific error category.
 */
export function getSuggestedFixes(errorCategory: string | null): string[] {
  if (!errorCategory) return [];

  const fixesByCategory: Record<string, string[]> = {
    inventory_sync_failed: [
      "Open the listing and tap Sync now",
      "Confirm the eBay listing is still active and not ended",
      "Check Sync Stores for eBay connection errors",
    ],
    content_sync_failed: [
      "Verify title is under 80 characters and at least one photo is attached",
      "Save the listing, then run Sync now",
      "For imported eBay listings, edit item specifics on eBay (not in INW)",
    ],
    aspect_mismatch: [
      "Review the eBay Listing Requirements section and fill in all required item specifics",
      "Check that aspect names match eBay's expected names for your category",
      "Remove any custom aspects that aren't in eBay's taxonomy",
    ],
    condition_invalid: [
      "Go to the listing and select a valid condition for this eBay category",
      "Some categories only allow specific conditions (e.g., 'New' for certain electronics)",
    ],
    policy_missing: [
      "Go to Seller Hub > Sync Stores > eBay and configure business policies",
      "Make sure you have fulfillment, return, and payment policies set up on eBay",
    ],
    taxonomy_invalid: [
      "Select a different Etsy category for this listing",
      "The category may have been removed or merged by Etsy",
    ],
    shipping_missing: [
      "Create a shipping profile in your Etsy Shop Manager",
      "Reconnect your Etsy account in Sync Stores after setting up shipping",
    ],
    shipping_package_missing: [
      "Retry listing — INW now sends a default package size for calculated Etsy shipping",
      "On Etsy, edit the listing's package weight and dimensions if the item is much larger or smaller",
    ],
    auth_expired: [
      "Reconnect your account in Seller Hub > Sync Stores",
      "If the issue persists, try revoking and re-granting access",
    ],
    rate_limit: [
      "Wait for the rate limit to reset (usually within an hour)",
      "Reduce the frequency of listing updates",
      "Consider batching changes instead of syncing after every edit",
    ],
    field_missing: [
      "Open Sync Stores → Needs Attention and fill the missing Etsy fields",
      "Save and retry from that tab so only Etsy is updated",
    ],
    listing_prohibited: [
      "Open Sync Stores → Needs Attention and try a different Etsy category",
      "If Etsy still rejects it, skip Etsy for this listing — the item is not allowed on that marketplace",
    ],
    photo_missing: [
      "Add at least one photo to the listing before syncing",
      "Make sure photos are high quality and meet marketplace requirements",
    ],
  };

  return fixesByCategory[errorCategory] || [];
}

/**
 * Get a human-readable label for an error category.
 */
export function getErrorCategoryLabel(category: string | null): string {
  const labels: Record<string, string> = {
    aspect_mismatch: "Item Specifics Mismatch",
    inventory_sync_failed: "Inventory Sync Failed",
    content_sync_failed: "Content Sync Failed",
    condition_invalid: "Invalid Condition",
    policy_missing: "Missing Business Policies",
    merchant_location_missing: "Missing Merchant Location",
    category_invalid: "Invalid Category",
    sku_conflict: "SKU Already Exists",
    rate_limit: "Rate Limit Exceeded",
    photo_missing: "Photo Required",
    title_invalid: "Invalid Title",
    price_invalid: "Invalid Price",
    taxonomy_invalid: "Invalid Etsy Category",
    shipping_missing: "Missing Shipping Profile",
    shipping_package_missing: "Missing Package Size",
    field_missing: "Required Field Missing",
    listing_prohibited: "Item Not Allowed",
    listing_not_found: "Listing Not Found",
    description_invalid: "Description Too Long",
    shop_inactive: "Shop Inactive",
    processing_profile_missing: "Processing Profile Missing",
    auth_expired: "Authentication Expired",
    network_error: "Network Error",
    channel_unavailable: "Channel Unavailable",
    permission_denied: "Permission Denied",
    payload_invalid: "Invalid Request",
    unknown: "Unknown Error",
  };

  return labels[category ?? "unknown"] || "Unknown Error";
}
