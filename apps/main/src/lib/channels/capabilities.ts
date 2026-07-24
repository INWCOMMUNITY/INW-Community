import type { ChannelProvider } from "./types";

/**
 * Per-provider capability flags so shared reconcile/import paths stay adaptive
 * (including a future Depop adapter) without hard-coding provider === "wix".
 */
export type ChannelCapabilities = {
  /** Participate in baseline most-recent-wins catalog reconcile. */
  supportsBaselineCatalogReconcile: boolean;
  /** Platform delivers inventory/order webhooks we can wire. */
  supportsWebhooks: boolean;
  /** Listing descriptions accept HTML subset outbound. */
  supportsHtmlDescription: boolean;
  /** Variant axes can be imported/exported. */
  supportsVariants: boolean;
  /** Adapter implements fetchProductQuantity. */
  supportsFetchProductQuantity: boolean;
};

const CAPABILITIES: Record<ChannelProvider, ChannelCapabilities> = {
  wix: {
    supportsBaselineCatalogReconcile: true,
    supportsWebhooks: true,
    supportsHtmlDescription: true,
    supportsVariants: true,
    supportsFetchProductQuantity: true,
  },
  ebay: {
    supportsBaselineCatalogReconcile: true,
    supportsWebhooks: true,
    supportsHtmlDescription: true,
    supportsVariants: true,
    supportsFetchProductQuantity: true,
  },
  etsy: {
    supportsBaselineCatalogReconcile: true,
    supportsWebhooks: true,
    supportsHtmlDescription: false,
    supportsVariants: true,
    supportsFetchProductQuantity: true,
  },
  shopify: {
    supportsBaselineCatalogReconcile: true,
    supportsWebhooks: true,
    supportsHtmlDescription: true,
    supportsVariants: true,
    supportsFetchProductQuantity: true,
  },
};

export function getChannelCapabilities(provider: ChannelProvider): ChannelCapabilities {
  return CAPABILITIES[provider];
}

/**
 * Checklist for adding a new marketplace (e.g. Depop) later — keep in sync with
 * docs/CHANNEL-SYNC-RULES.md § Depop-ready.
 */
export const NEW_PROVIDER_ADAPTER_CHECKLIST = [
  "Add ChannelProvider union + CHANNEL_PROVIDERS entry",
  "Implement ChannelAdapter under apps/main/src/lib/channels/{provider}/",
  "Register adapter in registry.ts",
  "Add getChannelCapabilities() flags (honest remoteUpdatedAt + quantityKnown)",
  "OAuth connect/callback routes + env vars",
  "Import UI row in provider-ui.ts + mobile Sync Stores",
  "Optional webhook route with signature verify + ChannelSyncEvent sales path",
  "fetchProductQuantity + inventory read-back verify on updateInventory",
] as const;
