/**
 * Pre-publish validation for channel listings.
 * Validates an item against provider requirements BEFORE attempting to publish,
 * catching issues early and providing actionable feedback to sellers.
 */

import type { ChannelProvider, SyncStoreItem } from "./types";
import {
  getProviderRequirements,
  checkFieldValue,
  type ProviderFieldSpec,
} from "./field-requirements";
import { publishBlockReason } from "./connection-publish";
import { getItemAspectsForCategory } from "./ebay/aspects";
import { formatAspectValidationErrors, prepareAspectsForEbayCategory } from "./ebay/aspect-prep";
import { parseStoredAspects } from "../listing-limits";

export interface ValidationError {
  field: string;
  message: string;
  /** Severity: error blocks publish, warning is informational */
  severity: "error" | "warning";
}

export interface ProviderValidationResult {
  provider: ChannelProvider;
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  /** Specific reason if connection isn't ready */
  connectionBlockReason?: string;
}

export interface ValidationResult {
  valid: boolean;
  byProvider: Record<ChannelProvider, ProviderValidationResult>;
}

type ConnectionRow = {
  provider: string;
  status: string;
  etsyShippingProfileId: string | null;
  config: unknown;
  accessTokenEncrypted?: string | null;
};

type PartialItem = Partial<SyncStoreItem> & {
  title?: string;
  photos?: string[];
  priceCents?: number;
  quantity?: number;
};

/**
 * Validate an item for a single provider.
 */
export async function validateForProvider(
  item: PartialItem,
  provider: ChannelProvider,
  connection?: ConnectionRow | null,
  options?: { fetchEbayAspects?: boolean; accessToken?: string }
): Promise<ProviderValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const requirements = getProviderRequirements(provider);

  // Check connection readiness
  let connectionBlockReason: string | undefined;
  if (connection) {
    const reason = publishBlockReason(connection);
    if (reason) {
      connectionBlockReason = reason;
      errors.push({
        field: "connection",
        message: reason,
        severity: "error",
      });
    }
  } else if (requirements.requiresConnectionSetup) {
    connectionBlockReason = `${provider.charAt(0).toUpperCase() + provider.slice(1)} is not connected.`;
    errors.push({
      field: "connection",
      message: connectionBlockReason,
      severity: "error",
    });
  }

  // Title validation
  const title = item.title?.trim() ?? "";
  if (!title) {
    errors.push({ field: "title", message: "Title is required", severity: "error" });
  } else if (title.length > requirements.titleMax) {
    errors.push({
      field: "title",
      message: `Title exceeds ${requirements.titleMax} character limit (${title.length} chars)`,
      severity: "error",
    });
  } else if (title.length > requirements.titleMax * 0.9) {
    warnings.push({
      field: "title",
      message: `Title is close to the ${requirements.titleMax} character limit`,
      severity: "warning",
    });
  }

  // Photo validation
  const photos = item.photos ?? [];
  if (photos.length < requirements.photoMin) {
    errors.push({
      field: "photos",
      message:
        requirements.photoMin === 1
          ? "At least 1 photo is required"
          : `At least ${requirements.photoMin} photos are required`,
      severity: "error",
    });
  }
  if (photos.length > requirements.photoMax) {
    warnings.push({
      field: "photos",
      message: `${provider} allows maximum ${requirements.photoMax} photos. Extra photos will be ignored.`,
      severity: "warning",
    });
  }

  // Price validation
  const priceCents = item.priceCents;
  if (priceCents === undefined || priceCents === null || priceCents < 1) {
    errors.push({ field: "priceCents", message: "Price must be at least $0.01", severity: "error" });
  }

  // Quantity validation
  const quantity = item.quantity;
  if (quantity === undefined || quantity === null || quantity < 1) {
    errors.push({ field: "quantity", message: "Quantity must be at least 1", severity: "error" });
  }

  // Description length validation
  const description = item.description ?? "";
  if (requirements.descriptionMax && description.length > requirements.descriptionMax) {
    errors.push({
      field: "description",
      message: `Description exceeds ${requirements.descriptionMax} character limit`,
      severity: "error",
    });
  }

  // Provider-specific validations
  if (provider === "ebay") {
    validateEbay(item, errors, warnings, options);
    if (item.ebayCategoryId) {
      await validateEbayAspectsWithRemap(item, errors, warnings);
    }
  } else if (provider === "etsy") {
    validateEtsy(item, connection, errors, warnings);
  } else if (provider === "shopify") {
    validateShopify(item, connection, errors, warnings);
  } else if (provider === "wix") {
    validateWix(item, errors, warnings);
  }

  // Check all provider field specs
  for (const field of requirements.fields) {
    const value = getFieldValue(item, field.field);
    const check = checkFieldValue(field, value, item as Partial<SyncStoreItem>);
    if (!check.valid && check.error) {
      const exists = errors.some((e) => e.field === field.field);
      if (!exists) {
        errors.push({ field: field.field, message: check.error, severity: "error" });
      }
    }
  }

  return {
    provider,
    valid: errors.length === 0,
    errors,
    warnings,
    connectionBlockReason,
  };
}

function getFieldValue(item: PartialItem, field: string): unknown {
  return (item as Record<string, unknown>)[field];
}

function validateEbay(
  item: PartialItem,
  errors: ValidationError[],
  warnings: ValidationError[],
  _options?: { fetchEbayAspects?: boolean; accessToken?: string }
): void {
  if (!item.ebayCategoryId) {
    errors.push({
      field: "ebayCategoryId",
      message: "eBay category is required for publishing. Search and select a category.",
      severity: "error",
    });
  }

  if (!item.condition) {
    errors.push({
      field: "condition",
      message: "Item condition (new/used) is required for eBay",
      severity: "error",
    });
  }

  const aspects = parseStoredAspects(item.aspects);
  if (aspects.length === 0 && item.ebayCategoryId) {
    warnings.push({
      field: "aspects",
      message:
        "Adding item specifics (Brand, Type, etc.) improves search visibility. Some may be required for this category.",
      severity: "warning",
    });
  }
}

async function validateEbayAspectsWithRemap(
  item: PartialItem,
  errors: ValidationError[],
  warnings: ValidationError[]
): Promise<void> {
  if (!item.ebayCategoryId) return;

  try {
    const categoryAspects = await getItemAspectsForCategory(String(item.ebayCategoryId));
    const prep = prepareAspectsForEbayCategory(
      categoryAspects,
      parseStoredAspects(item.aspects),
      item.title ?? ""
    );

    if (prep.missingRequired.length > 0 || prep.invalidSelectionValues.length > 0) {
      const message = formatAspectValidationErrors(prep.missingRequired, prep.invalidSelectionValues);
      const exists = errors.some((e) => e.field === "aspects");
      if (!exists) {
        errors.push({ field: "aspects", message, severity: "error" });
      }
    }
  } catch {
    warnings.push({
      field: "aspects",
      message: "Could not validate required item specifics. They will be checked again on sync.",
      severity: "warning",
    });
  }
}

function validateEtsy(
  item: PartialItem,
  connection: ConnectionRow | null | undefined,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  // Etsy-specific required fields
  if (!item.etsyWhoMade) {
    errors.push({
      field: "etsyWhoMade",
      message: 'Etsy requires you to specify who made the item (select "Who made it?")',
      severity: "error",
    });
  }

  if (!item.etsyWhenMade) {
    errors.push({
      field: "etsyWhenMade",
      message: 'Etsy requires you to specify when it was made (select "When was it made?")',
      severity: "error",
    });
  }

  if (item.etsyIsSupply === null || item.etsyIsSupply === undefined) {
    warnings.push({
      field: "etsyIsSupply",
      message: "Etsy craft supply status will default to 'No'. Set explicitly if this is a supply.",
      severity: "warning",
    });
  }

  // Shipping profile check
  if (connection && !connection.etsyShippingProfileId) {
    if (!item.shippingCostCents && item.shippingCostCents !== 0) {
      errors.push({
        field: "shippingCostCents",
        message:
          "Set a shipping cost or configure an Etsy shipping profile. Listings without shipping stay as drafts.",
        severity: "error",
      });
    }
  }
}

function validateShopify(
  item: PartialItem,
  connection: ConnectionRow | null | undefined,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  // Shopify requires location for inventory tracking
  if (connection) {
    const config = (connection.config ?? {}) as Record<string, unknown>;
    if (!config.locationId) {
      errors.push({
        field: "connection",
        message: "Shopify inventory location is not configured. Set up in Sync Stores.",
        severity: "error",
      });
    }
  }

  // Category helps with organization
  if (!item.category) {
    warnings.push({
      field: "category",
      message: "Setting a category helps organize products in your Shopify store.",
      severity: "warning",
    });
  }
}

function validateWix(
  item: PartialItem,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  // Wix title limit
  const title = item.title?.trim() ?? "";
  if (title.length > 80) {
    errors.push({
      field: "title",
      message: "Wix titles are limited to 80 characters",
      severity: "error",
    });
  }

  // Description limit
  const description = item.description ?? "";
  if (description.length > 8000) {
    errors.push({
      field: "description",
      message: "Wix descriptions are limited to 8,000 characters",
      severity: "error",
    });
  }

  // Category as collection
  if (!item.category) {
    warnings.push({
      field: "category",
      message: "Setting a category creates a Wix collection for easier browsing.",
      severity: "warning",
    });
  }
}

/**
 * Validate an item for multiple providers at once.
 */
export async function validateForProviders(
  item: PartialItem,
  providers: ChannelProvider[],
  connections: ConnectionRow[],
  options?: { fetchEbayAspects?: boolean }
): Promise<ValidationResult> {
  const connectionByProvider = new Map(connections.map((c) => [c.provider, c]));
  const byProvider: Record<string, ProviderValidationResult> = {};
  let allValid = true;

  for (const provider of providers) {
    const connection = connectionByProvider.get(provider) ?? null;
    const accessToken =
      provider === "ebay" && connection?.accessTokenEncrypted
        ? await decryptTokenIfNeeded(connection)
        : undefined;

    const result = await validateForProvider(item, provider, connection, {
      fetchEbayAspects: options?.fetchEbayAspects,
      accessToken,
    });

    byProvider[provider] = result;
    if (!result.valid) {
      allValid = false;
    }
  }

  return {
    valid: allValid,
    byProvider: byProvider as Record<ChannelProvider, ProviderValidationResult>,
  };
}

async function decryptTokenIfNeeded(connection: ConnectionRow): Promise<string | undefined> {
  if (!connection.accessTokenEncrypted) return undefined;
  try {
    const { decrypt } = await import("@/lib/encrypt");
    return decrypt(connection.accessTokenEncrypted);
  } catch {
    return undefined;
  }
}

/**
 * Quick validation without fetching external data (eBay aspects).
 * Use for real-time form feedback.
 */
export function validateForProviderQuick(
  item: PartialItem,
  provider: ChannelProvider,
  connection?: ConnectionRow | null
): ProviderValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const requirements = getProviderRequirements(provider);

  // Check connection readiness
  let connectionBlockReason: string | undefined;
  if (connection) {
    const reason = publishBlockReason(connection);
    if (reason) {
      connectionBlockReason = reason;
      errors.push({ field: "connection", message: reason, severity: "error" });
    }
  }

  // Title
  const title = item.title?.trim() ?? "";
  if (!title) {
    errors.push({ field: "title", message: "Title is required", severity: "error" });
  } else if (title.length > requirements.titleMax) {
    errors.push({
      field: "title",
      message: `Title exceeds ${requirements.titleMax} character limit`,
      severity: "error",
    });
  }

  // Photos
  const photos = item.photos ?? [];
  if (photos.length < requirements.photoMin) {
    errors.push({
      field: "photos",
      message: `At least ${requirements.photoMin} photo${requirements.photoMin > 1 ? "s" : ""} required`,
      severity: "error",
    });
  }

  // Price
  if (!item.priceCents || item.priceCents < 1) {
    errors.push({ field: "priceCents", message: "Price is required", severity: "error" });
  }

  // Quantity
  if (!item.quantity || item.quantity < 1) {
    errors.push({ field: "quantity", message: "Quantity is required", severity: "error" });
  }

  // Provider-specific quick checks
  if (provider === "ebay" && !item.ebayCategoryId) {
    errors.push({ field: "ebayCategoryId", message: "eBay category required", severity: "error" });
  }

  if (provider === "etsy") {
    if (!item.etsyWhoMade) {
      errors.push({ field: "etsyWhoMade", message: "Who made it? is required", severity: "error" });
    }
    if (!item.etsyWhenMade) {
      errors.push({
        field: "etsyWhenMade",
        message: "When was it made? is required",
        severity: "error",
      });
    }
  }

  return {
    provider,
    valid: errors.length === 0,
    errors,
    warnings,
    connectionBlockReason,
  };
}

/**
 * Get a summary of validation issues for display.
 */
export function summarizeValidation(result: ValidationResult): {
  canPublish: boolean;
  errorCount: number;
  warningCount: number;
  summary: string;
} {
  let errorCount = 0;
  let warningCount = 0;
  const providerIssues: string[] = [];

  for (const [provider, pResult] of Object.entries(result.byProvider)) {
    errorCount += pResult.errors.length;
    warningCount += pResult.warnings.length;
    if (pResult.errors.length > 0) {
      providerIssues.push(`${provider}: ${pResult.errors.length} issue${pResult.errors.length > 1 ? "s" : ""}`);
    }
  }

  let summary: string;
  if (errorCount === 0) {
    summary =
      warningCount > 0
        ? `Ready to publish with ${warningCount} warning${warningCount > 1 ? "s" : ""}`
        : "Ready to publish";
  } else {
    summary = providerIssues.join(", ");
  }

  return {
    canPublish: errorCount === 0,
    errorCount,
    warningCount,
    summary,
  };
}
