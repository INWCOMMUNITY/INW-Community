/**
 * Universal field schema for channel listing requirements.
 * Defines what data each marketplace needs for publishing, enabling:
 * - Dynamic form fields based on connected channels
 * - Pre-publish validation across all target providers
 * - Merged requirements when publishing to multiple channels
 */

import type { ChannelProvider, SyncStoreItem } from "./types";
import { ETSY_WHEN_MADE_OPTIONS, ETSY_WHO_MADE_OPTIONS } from "@/lib/etsy-listing-options";

export type FieldType = "text" | "select" | "boolean" | "number" | "category" | "aspects";

export interface ProviderFieldSpec {
  /** Field key matching SyncStoreItem or channel-specific field */
  field: string;
  /** Human-readable label for UI */
  label: string;
  /** Input type */
  type: FieldType;
  /** Whether this field is required for publish */
  required: boolean;
  /** Max character length for text fields */
  maxLength?: number;
  /** Options for select fields */
  options?: { value: string; label: string }[];
  /** Help text shown below field */
  helpText?: string;
  /** Conditional requirement - field only required when condition returns true */
  condition?: (item: Partial<SyncStoreItem>) => boolean;
  /** Provider-specific field (not part of base StoreItem) */
  providerSpecific?: boolean;
}

export interface ProviderRequirements {
  provider: ChannelProvider;
  /** Field specifications for this provider */
  fields: ProviderFieldSpec[];
  /** Minimum photos required (0 = optional) */
  photoMin: number;
  /** Maximum photos allowed */
  photoMax: number;
  /** Maximum title length */
  titleMax: number;
  /** Maximum description length (null = unlimited) */
  descriptionMax: number | null;
  /** Whether connection-level setup is required (policies, shipping profiles, etc.) */
  requiresConnectionSetup: boolean;
  /** Human-readable description of connection setup requirements */
  connectionSetupDescription?: string;
}

export interface MergedFieldSpec extends ProviderFieldSpec {
  /** Providers that require this field */
  requiredBy: ChannelProvider[];
  /** Providers that support this field (optional) */
  supportedBy: ChannelProvider[];
  /** Most restrictive maxLength across providers */
  effectiveMaxLength?: number;
}

export interface MergedRequirements {
  fields: MergedFieldSpec[];
  photoMin: number;
  photoMax: number;
  titleMax: number;
  descriptionMax: number | null;
}

const CONDITION_OPTIONS = [
  { value: "new", label: "New" },
  { value: "used", label: "Used / Pre-owned" },
];

const EBAY_REQUIREMENTS: ProviderRequirements = {
  provider: "ebay",
  photoMin: 1,
  photoMax: 12,
  titleMax: 80,
  descriptionMax: 500000,
  requiresConnectionSetup: true,
  connectionSetupDescription:
    "eBay requires business policies (payment, return, shipping) and a merchant location to publish live listings.",
  fields: [
    {
      field: "title",
      label: "Title",
      type: "text",
      required: true,
      maxLength: 80,
      helpText: "eBay titles are limited to 80 characters for best search visibility.",
    },
    {
      field: "description",
      label: "Description",
      type: "text",
      required: false,
      helpText: "Detailed description of the item.",
    },
    {
      field: "photos",
      label: "Photos",
      type: "text",
      required: true,
      helpText: "At least 1 photo required, up to 12 allowed.",
    },
    {
      field: "priceCents",
      label: "Price",
      type: "number",
      required: true,
    },
    {
      field: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
    },
    {
      field: "condition",
      label: "Condition",
      type: "select",
      required: true,
      options: CONDITION_OPTIONS,
      helpText: "Item condition affects buyer expectations and search placement.",
    },
    {
      field: "ebayCategoryId",
      label: "eBay Category",
      type: "category",
      required: true,
      providerSpecific: true,
      helpText:
        "Select the most specific eBay category. Required item specifics depend on the category chosen.",
    },
    {
      field: "aspects",
      label: "Item Specifics",
      type: "aspects",
      required: false,
      providerSpecific: true,
      helpText:
        "Item specifics (Brand, Type, etc.) improve search visibility. Some are required depending on category.",
    },
    {
      field: "shippingCostCents",
      label: "Shipping Cost",
      type: "number",
      required: false,
      helpText:
        "Flat shipping rate for your INW storefront only. eBay sync uses your connected eBay fulfillment (shipping) policy — per-listing flat rates are not pushed to eBay.",
    },
  ],
};

const ETSY_REQUIREMENTS: ProviderRequirements = {
  provider: "etsy",
  photoMin: 1,
  photoMax: 10,
  titleMax: 140,
  descriptionMax: 65535,
  requiresConnectionSetup: true,
  connectionSetupDescription:
    "Etsy requires a shipping profile to publish live listings. One is auto-created if you set a shipping cost.",
  fields: [
    {
      field: "title",
      label: "Title",
      type: "text",
      required: true,
      maxLength: 140,
      helpText: "Etsy allows up to 140 characters, but shorter titles often perform better.",
    },
    {
      field: "description",
      label: "Description",
      type: "text",
      required: false,
    },
    {
      field: "photos",
      label: "Photos",
      type: "text",
      required: true,
      helpText: "At least 1 photo required, up to 10 allowed.",
    },
    {
      field: "priceCents",
      label: "Price",
      type: "number",
      required: true,
    },
    {
      field: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
    },
    {
      field: "etsyWhoMade",
      label: "Who made it?",
      type: "select",
      required: true,
      options: [...ETSY_WHO_MADE_OPTIONS],
      providerSpecific: true,
      helpText: "Etsy requires you to specify who made this item.",
    },
    {
      field: "etsyWhenMade",
      label: "When was it made?",
      type: "select",
      required: true,
      options: [...ETSY_WHEN_MADE_OPTIONS],
      providerSpecific: true,
      helpText: "Items made before 20 years ago qualify as vintage.",
    },
    {
      field: "etsyIsSupply",
      label: "Is this a supply or tool?",
      type: "boolean",
      required: false,
      providerSpecific: true,
      helpText: "Check if this is a craft supply or tool for making things.",
    },
    {
      field: "etsyTaxonomyId",
      label: "Etsy Category",
      type: "category",
      required: false,
      providerSpecific: true,
      helpText: "Optional: Select an Etsy-specific category for better placement.",
    },
    {
      field: "category",
      label: "Category",
      type: "category",
      required: false,
      helpText: "INW category, auto-mapped to Etsy taxonomy.",
    },
    {
      field: "shippingCostCents",
      label: "Shipping Cost",
      type: "number",
      required: false,
      helpText: "A shipping profile will be auto-created if you set a shipping cost.",
    },
  ],
};

const SHOPIFY_REQUIREMENTS: ProviderRequirements = {
  provider: "shopify",
  photoMin: 0,
  photoMax: 250,
  titleMax: 255,
  descriptionMax: null,
  requiresConnectionSetup: true,
  connectionSetupDescription: "Shopify requires an inventory location to be configured.",
  fields: [
    {
      field: "title",
      label: "Title",
      type: "text",
      required: true,
      maxLength: 255,
    },
    {
      field: "description",
      label: "Description",
      type: "text",
      required: false,
    },
    {
      field: "photos",
      label: "Photos",
      type: "text",
      required: false,
      helpText: "Photos are optional but recommended for better conversion.",
    },
    {
      field: "priceCents",
      label: "Price",
      type: "number",
      required: true,
    },
    {
      field: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
    },
    {
      field: "category",
      label: "Product Type",
      type: "category",
      required: false,
      helpText: "Maps to Shopify product type for organization.",
    },
    {
      field: "condition",
      label: "Condition",
      type: "select",
      required: false,
      options: CONDITION_OPTIONS,
    },
  ],
};

const WIX_REQUIREMENTS: ProviderRequirements = {
  provider: "wix",
  photoMin: 0,
  photoMax: 15,
  titleMax: 80,
  descriptionMax: 8000,
  requiresConnectionSetup: false,
  fields: [
    {
      field: "title",
      label: "Title",
      type: "text",
      required: true,
      maxLength: 80,
    },
    {
      field: "description",
      label: "Description",
      type: "text",
      required: false,
      maxLength: 8000,
    },
    {
      field: "photos",
      label: "Photos",
      type: "text",
      required: false,
      helpText: "Photos are optional, up to 15 allowed.",
    },
    {
      field: "priceCents",
      label: "Price",
      type: "number",
      required: true,
    },
    {
      field: "quantity",
      label: "Quantity",
      type: "number",
      required: true,
    },
    {
      field: "category",
      label: "Collection",
      type: "category",
      required: false,
      helpText: "Maps to a Wix collection (created automatically if needed).",
    },
  ],
};

const PROVIDER_REQUIREMENTS: Record<ChannelProvider, ProviderRequirements> = {
  ebay: EBAY_REQUIREMENTS,
  etsy: ETSY_REQUIREMENTS,
  shopify: SHOPIFY_REQUIREMENTS,
  wix: WIX_REQUIREMENTS,
};

/**
 * Get field requirements for a single provider.
 */
export function getProviderRequirements(provider: ChannelProvider): ProviderRequirements {
  return PROVIDER_REQUIREMENTS[provider];
}

/**
 * Get all provider requirements.
 */
export function getAllProviderRequirements(): Record<ChannelProvider, ProviderRequirements> {
  return PROVIDER_REQUIREMENTS;
}

/**
 * Merge field requirements from multiple providers.
 * Fields are marked as required if ANY provider requires them.
 * Uses the most restrictive limits (shortest maxLength, etc.).
 */
export function getMergedRequirements(providers: ChannelProvider[]): MergedRequirements {
  if (providers.length === 0) {
    return {
      fields: [],
      photoMin: 0,
      photoMax: 12,
      titleMax: 80,
      descriptionMax: null,
    };
  }

  const fieldMap = new Map<string, MergedFieldSpec>();
  let photoMin = 0;
  let photoMax = Infinity;
  let titleMax = Infinity;
  let descriptionMax: number | null = null;

  for (const provider of providers) {
    const req = PROVIDER_REQUIREMENTS[provider];

    photoMin = Math.max(photoMin, req.photoMin);
    photoMax = Math.min(photoMax, req.photoMax);
    titleMax = Math.min(titleMax, req.titleMax);
    if (req.descriptionMax !== null) {
      descriptionMax =
        descriptionMax === null ? req.descriptionMax : Math.min(descriptionMax, req.descriptionMax);
    }

    for (const field of req.fields) {
      const existing = fieldMap.get(field.field);
      if (existing) {
        if (field.required) {
          existing.required = true;
          existing.requiredBy.push(provider);
        } else {
          existing.supportedBy.push(provider);
        }
        if (field.maxLength !== undefined) {
          existing.effectiveMaxLength =
            existing.effectiveMaxLength === undefined
              ? field.maxLength
              : Math.min(existing.effectiveMaxLength, field.maxLength);
        }
      } else {
        fieldMap.set(field.field, {
          ...field,
          requiredBy: field.required ? [provider] : [],
          supportedBy: field.required ? [] : [provider],
          effectiveMaxLength: field.maxLength,
        });
      }
    }
  }

  const fields = Array.from(fieldMap.values()).sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.providerSpecific !== b.providerSpecific) return a.providerSpecific ? 1 : -1;
    return a.field.localeCompare(b.field);
  });

  return {
    fields,
    photoMin,
    photoMax: photoMax === Infinity ? 12 : photoMax,
    titleMax: titleMax === Infinity ? 80 : titleMax,
    descriptionMax,
  };
}

/**
 * Check if a field value meets a provider's requirements.
 */
export function checkFieldValue(
  field: ProviderFieldSpec,
  value: unknown,
  item?: Partial<SyncStoreItem>
): { valid: boolean; error?: string } {
  if (field.condition && item && !field.condition(item)) {
    return { valid: true };
  }

  if (field.required) {
    if (value === null || value === undefined) {
      return { valid: false, error: `${field.label} is required` };
    }
    if (typeof value === "string" && value.trim() === "") {
      return { valid: false, error: `${field.label} is required` };
    }
    if (Array.isArray(value) && value.length === 0) {
      return { valid: false, error: `${field.label} is required` };
    }
  }

  if (value !== null && value !== undefined) {
    if (field.type === "text" && typeof value === "string" && field.maxLength) {
      if (value.length > field.maxLength) {
        return {
          valid: false,
          error: `${field.label} exceeds maximum length of ${field.maxLength} characters`,
        };
      }
    }

    if (field.type === "select" && field.options) {
      const validValues = field.options.map((o) => o.value);
      if (!validValues.includes(value as string)) {
        return { valid: false, error: `${field.label} has an invalid value` };
      }
    }

    if (field.type === "number") {
      const num = typeof value === "number" ? value : Number(value);
      if (isNaN(num)) {
        return { valid: false, error: `${field.label} must be a number` };
      }
    }
  }

  return { valid: true };
}

/**
 * Get provider-specific fields that aren't part of the base StoreItem.
 */
export function getProviderSpecificFields(provider: ChannelProvider): ProviderFieldSpec[] {
  return PROVIDER_REQUIREMENTS[provider].fields.filter((f) => f.providerSpecific);
}

/**
 * Get all providers that require a specific field.
 */
export function getProvidersRequiringField(
  field: string,
  providers: ChannelProvider[]
): ChannelProvider[] {
  return providers.filter((p) => {
    const req = PROVIDER_REQUIREMENTS[p];
    return req.fields.some((f) => f.field === field && f.required);
  });
}

/**
 * Check if a provider's connection is properly configured for publishing.
 */
export function requiresConnectionSetup(provider: ChannelProvider): boolean {
  return PROVIDER_REQUIREMENTS[provider].requiresConnectionSetup;
}

/**
 * Get human-readable connection setup requirements.
 */
export function getConnectionSetupDescription(provider: ChannelProvider): string | undefined {
  return PROVIDER_REQUIREMENTS[provider].connectionSetupDescription;
}
