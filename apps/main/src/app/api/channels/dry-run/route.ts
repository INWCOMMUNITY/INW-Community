import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { syncStoreItemSelect, toSyncStoreItem } from "@/lib/channels/store-item";
import { parseStoredAspects } from "@/lib/listing-limits";
import type { ChannelProvider, SyncStoreItem } from "@/lib/channels/types";
import { readEbayConfig } from "@/lib/channels/ebay/account";
import { getItemAspectsForCategory, type EbayCategoryAspect } from "@/lib/channels/ebay/aspects";
import {
  fillEmptyTaxonomyAspectsFromTitle,
  remapAspectsToTaxonomy,
  validateRemappedAspects,
  validateListingForEbay,
} from "@/lib/channels/ebay/ebay-compat";
import { getSuggestedFixes } from "@/lib/channels/error-classifiers-registry";

export const dynamic = "force-dynamic";

type ValidationCheck = {
  name: string;
  passed: boolean;
  detail?: string;
  severity: "error" | "warning";
};

type TransformPreview = {
  inputAspects: { name: string; value: string }[];
  outputAspects: { name: string; value: string }[];
  remaps: { from: string; to: string }[];
  dropped: string[];
};

type DryRunResponse = {
  wouldSucceed: boolean;
  validationChecks: ValidationCheck[];
  transformPreview: TransformPreview | null;
  predictedPayload: Record<string, unknown> | null;
  categorySchema: { name: string; required: boolean; mode: string }[] | null;
  suggestedFixes: string[];
  blockReasons: string[];
};

/**
 * POST /api/channels/dry-run
 *
 * Simulate a sync operation and predict the outcome without making actual API calls.
 * 
 * Body:
 *   - provider: "ebay" | "etsy" | "wix" | "shopify"
 *   - storeItemId: string
 *
 * Returns:
 *   - Whether the sync would succeed
 *   - Validation checks with pass/fail status
 *   - Preview of aspect transforms
 *   - Predicted API payload
 *   - Category schema from taxonomy
 *   - Suggested fixes for any issues
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { provider?: string; storeItemId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider as ChannelProvider;
  const storeItemId = body.storeItemId?.trim();

  if (!provider || !storeItemId) {
    return NextResponse.json({ error: "provider and storeItemId are required" }, { status: 400 });
  }

  // Load the store item
  const itemRow = await prisma.storeItem.findFirst({
    where: { id: storeItemId, memberId: userId },
    select: syncStoreItemSelect,
  });

  if (!itemRow) {
    return NextResponse.json({ error: "Store item not found" }, { status: 404 });
  }

  const item = toSyncStoreItem(itemRow);

  // Get connection context
  const ctx = await getMemberConnectionContext(userId, provider);
  if (!ctx) {
    return NextResponse.json<DryRunResponse>({
      wouldSucceed: false,
      validationChecks: [{
        name: "connection",
        passed: false,
        detail: `No ${provider} connection found`,
        severity: "error",
      }],
      transformPreview: null,
      predictedPayload: null,
      categorySchema: null,
      suggestedFixes: [`Connect your ${provider} account in Seller Hub > Sync Stores`],
      blockReasons: [`No ${provider} connection`],
    });
  }

  // Provider-specific dry run
  if (provider === "ebay") {
    return NextResponse.json(await dryRunEbay(item, ctx.config));
  } else if (provider === "etsy") {
    return NextResponse.json(await dryRunEtsy(item));
  }

  // Generic dry run for other providers
  return NextResponse.json({
    wouldSucceed: true,
    validationChecks: [],
    transformPreview: null,
    predictedPayload: null,
    categorySchema: null,
    suggestedFixes: [],
    blockReasons: [],
  });
}

async function dryRunEbay(
  item: SyncStoreItem,
  connConfig: Record<string, unknown> | null
): Promise<DryRunResponse> {
  const checks: ValidationCheck[] = [];
  const blockReasons: string[] = [];
  let allSuggestedFixes: string[] = [];

  // Read config
  const cfg = readEbayConfig(connConfig);

  // Check policies
  checks.push({
    name: "fulfillment_policy",
    passed: !!cfg.fulfillmentPolicyId,
    detail: cfg.fulfillmentPolicyId ? cfg.fulfillmentPolicyName ?? "Configured" : "Not set",
    severity: "error",
  });
  if (!cfg.fulfillmentPolicyId) blockReasons.push("Missing fulfillment policy");

  checks.push({
    name: "payment_policy",
    passed: !!cfg.paymentPolicyId,
    detail: cfg.paymentPolicyId ? cfg.paymentPolicyName ?? "Configured" : "Not set",
    severity: "error",
  });
  if (!cfg.paymentPolicyId) blockReasons.push("Missing payment policy");

  checks.push({
    name: "return_policy",
    passed: !!cfg.returnPolicyId,
    detail: cfg.returnPolicyId ? cfg.returnPolicyName ?? "Configured" : "Not set",
    severity: "error",
  });
  if (!cfg.returnPolicyId) blockReasons.push("Missing return policy");

  checks.push({
    name: "merchant_location",
    passed: !!cfg.merchantLocationKey && cfg.merchantLocationEnabled,
    detail: cfg.merchantLocationKey ? cfg.merchantLocationName ?? "Configured" : "Not set",
    severity: "error",
  });
  if (!cfg.merchantLocationKey || !cfg.merchantLocationEnabled) {
    blockReasons.push("Missing or disabled merchant location");
  }

  // Check category
  const categoryId = item.ebayCategoryId;
  checks.push({
    name: "category",
    passed: !!categoryId,
    detail: categoryId ? `Category ID: ${categoryId}` : "Not set",
    severity: "error",
  });
  if (!categoryId) {
    blockReasons.push("No eBay category selected");
    allSuggestedFixes.push(...getSuggestedFixes("category_invalid"));
  }

  // Check condition
  checks.push({
    name: "condition",
    passed: !!item.condition,
    detail: item.ebayConditionEnum ?? item.condition ?? "Not set",
    severity: "error",
  });
  if (!item.condition) blockReasons.push("Item condition not set");

  // Check photos
  checks.push({
    name: "photos",
    passed: item.photos.length > 0,
    detail: `${item.photos.length} photo(s)`,
    severity: "error",
  });
  if (item.photos.length === 0) {
    blockReasons.push("No photos");
    allSuggestedFixes.push(...getSuggestedFixes("photo_missing"));
  }

  // Transform preview
  let transformPreview: TransformPreview | null = null;
  let categorySchema: { name: string; required: boolean; mode: string }[] | null = null;

  if (categoryId) {
    try {
      const categoryAspects = await getItemAspectsForCategory(String(categoryId));
      categorySchema = categoryAspects.map((a) => ({
        name: a.name,
        required: a.required,
        mode: a.mode,
      }));

      const inputAspects = parseStoredAspects(item.aspects);
      const merged = fillEmptyTaxonomyAspectsFromTitle(
        item.title,
        categoryAspects,
        inputAspects
      );
      const remapped = remapAspectsToTaxonomy(categoryAspects, merged);

      transformPreview = {
        inputAspects,
        outputAspects: remapped.aspects,
        remaps: remapped.valueAdjustments.map((a) => ({
          from: `${a.name}: ${a.from}`,
          to: `${a.name}: ${a.to}`,
        })),
        dropped: remapped.dropped,
      };

      // Validate aspects
      const aspectValidation = validateRemappedAspects(categoryAspects, remapped.aspects);
      
      checks.push({
        name: "required_aspects",
        passed: aspectValidation.missingRequired.length === 0,
        detail: aspectValidation.missingRequired.length === 0
          ? `All required aspects filled (${remapped.aspects.length} total)`
          : `Missing: ${aspectValidation.missingRequired.join(", ")}`,
        severity: "error",
      });
      if (aspectValidation.missingRequired.length > 0) {
        blockReasons.push(`Missing required aspects: ${aspectValidation.missingRequired.join(", ")}`);
        allSuggestedFixes.push(...getSuggestedFixes("aspect_mismatch"));
      }

      checks.push({
        name: "aspect_values",
        passed: aspectValidation.invalidSelectionValues.length === 0,
        detail: aspectValidation.invalidSelectionValues.length === 0
          ? "All aspect values valid"
          : `Invalid values for: ${aspectValidation.invalidSelectionValues.map((v) => v.name).join(", ")}`,
        severity: "error",
      });
      if (aspectValidation.invalidSelectionValues.length > 0) {
        blockReasons.push("Invalid aspect values");
      }

      // Check for dropped aspects
      if (remapped.dropped.length > 0) {
        checks.push({
          name: "dropped_aspects",
          passed: true,
          detail: `${remapped.dropped.length} aspect(s) not in taxonomy will be dropped: ${remapped.dropped.slice(0, 3).join(", ")}${remapped.dropped.length > 3 ? "..." : ""}`,
          severity: "warning",
        });
      }
    } catch (e) {
      checks.push({
        name: "taxonomy_fetch",
        passed: false,
        detail: `Could not load category taxonomy: ${String(e).slice(0, 100)}`,
        severity: "error",
      });
      blockReasons.push("Failed to load category taxonomy");
    }
  }

  // Build predicted payload preview
  const predictedPayload = categoryId
    ? {
        product: {
          title: item.title,
          description: item.description?.slice(0, 100) + (item.description && item.description.length > 100 ? "..." : ""),
          aspects: transformPreview?.outputAspects.reduce((acc, a) => {
            acc[a.name] = [a.value];
            return acc;
          }, {} as Record<string, string[]>),
          imageUrls: item.photos.slice(0, 3),
        },
        condition: item.ebayConditionEnum ?? item.condition,
        availability: {
          shipToLocationAvailability: {
            quantity: item.quantity,
          },
        },
      }
    : null;

  const wouldSucceed = checks.every((c) => c.passed || c.severity === "warning");

  return {
    wouldSucceed,
    validationChecks: checks,
    transformPreview,
    predictedPayload,
    categorySchema,
    suggestedFixes: [...new Set(allSuggestedFixes)],
    blockReasons,
  };
}

async function dryRunEtsy(item: SyncStoreItem): Promise<DryRunResponse> {
  const checks: ValidationCheck[] = [];
  const blockReasons: string[] = [];
  let allSuggestedFixes: string[] = [];

  // Check who_made
  checks.push({
    name: "who_made",
    passed: !!item.etsyWhoMade,
    detail: item.etsyWhoMade ?? "Not set",
    severity: "error",
  });
  if (!item.etsyWhoMade) {
    blockReasons.push("'Who made it?' not set");
    allSuggestedFixes.push(...getSuggestedFixes("field_missing"));
  }

  // Check when_made
  checks.push({
    name: "when_made",
    passed: !!item.etsyWhenMade,
    detail: item.etsyWhenMade ?? "Not set",
    severity: "error",
  });
  if (!item.etsyWhenMade) {
    blockReasons.push("'When was it made?' not set");
    allSuggestedFixes.push(...getSuggestedFixes("field_missing"));
  }

  // Check taxonomy
  checks.push({
    name: "taxonomy",
    passed: !!item.etsyTaxonomyId,
    detail: item.etsyTaxonomyId ? `Taxonomy ID: ${item.etsyTaxonomyId}` : "Not set",
    severity: "error",
  });
  if (!item.etsyTaxonomyId) {
    blockReasons.push("Etsy category not selected");
    allSuggestedFixes.push(...getSuggestedFixes("taxonomy_invalid"));
  }

  // Check photos
  checks.push({
    name: "photos",
    passed: item.photos.length > 0,
    detail: `${item.photos.length} photo(s)`,
    severity: "error",
  });
  if (item.photos.length === 0) {
    blockReasons.push("No photos");
    allSuggestedFixes.push(...getSuggestedFixes("photo_missing"));
  }

  // Check title length
  const titleLength = item.title.length;
  checks.push({
    name: "title_length",
    passed: titleLength <= 140,
    detail: `${titleLength} / 140 characters`,
    severity: titleLength > 140 ? "error" : "warning",
  });
  if (titleLength > 140) {
    blockReasons.push("Title exceeds 140 characters");
    allSuggestedFixes.push(...getSuggestedFixes("title_invalid"));
  }

  const wouldSucceed = checks.every((c) => c.passed || c.severity === "warning");

  return {
    wouldSucceed,
    validationChecks: checks,
    transformPreview: null,
    predictedPayload: {
      title: item.title,
      description: item.description?.slice(0, 100) + (item.description && item.description.length > 100 ? "..." : ""),
      price: { amount: item.priceCents, divisor: 100, currency_code: "USD" },
      quantity: item.quantity,
      who_made: item.etsyWhoMade,
      when_made: item.etsyWhenMade,
      taxonomy_id: item.etsyTaxonomyId,
      is_supply: item.etsyIsSupply ?? false,
    },
    categorySchema: null,
    suggestedFixes: [...new Set(allSuggestedFixes)],
    blockReasons,
  };
}
