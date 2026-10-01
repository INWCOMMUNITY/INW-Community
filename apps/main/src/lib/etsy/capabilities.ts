/**
 * Etsy adapter capability flags.
 * Marketplace-specific limits belong here — never distort canonical INW data to fit.
 */

export const ETSY_ADAPTER_CAPABILITIES = {
  supportsVariants: true,
  /** Opt-in via max_variations_supported=3 on inventory writes. */
  supportsThreeOptionDimensions: true,
  supportsVariantPrice: true,
  supportsVariantSku: true,
  supportsInventory: true,
  supportsMultipleLocations: false,
  supportsOrderWebhooks: true,
  supportsInventoryWebhooks: false,
  supportsProductWebhooks: false,
  supportsAbsoluteInventory: true,
  supportsInventoryAdjustment: false,
  /** Etsy inventory PUT is a full products[] replace. */
  inventoryUpdateIsFullReplace: true,
  supportsCompareAndSet: false,
  supportsIdempotency: false,
  supportsMediaOrdering: true,
  supportsVariantMedia: false,
  supportsBulkOperations: false,
  /** When price/qty/sku vary on all properties. */
  maxSkusWhenAllPropertiesVary: 400,
  maxSkusThreeVariations: 2500,
  maxVariationAxes: 3,
  /** sku / quantity / price / readiness must vary by 0, 1, or all axes — never 2-of-3. */
  onPropertyMustBeZeroOneOrAll: true,
} as const;

export type EtsyAdapterCapabilities = typeof ETSY_ADAPTER_CAPABILITIES;

export function getEtsyAdapterCapabilities(): EtsyAdapterCapabilities {
  return ETSY_ADAPTER_CAPABILITIES;
}
