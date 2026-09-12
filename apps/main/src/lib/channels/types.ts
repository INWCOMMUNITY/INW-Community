/**
 * Provider-agnostic sales-channel sync contracts.
 * Etsy is the first implementation; eBay/Shopify/Wix slot in by adding a new adapter
 * to the registry. INW is always the content source of truth; inventory is pooled
 * (a sale on any channel decrements the shared StoreItem.quantity, then the new
 * absolute quantity is pushed back out to every linked channel).
 */

export type ChannelProvider = "etsy" | "ebay" | "shopify" | "wix";

export const CHANNEL_PROVIDERS: ChannelProvider[] = ["etsy", "ebay", "shopify", "wix"];

export function isChannelProvider(value: string): value is ChannelProvider {
  return (CHANNEL_PROVIDERS as string[]).includes(value);
}

/** Minimal StoreItem projection needed to map a listing to an external channel. */
export type SyncStoreItem = {
  id: string;
  /** User-defined SKU; if unset, adapters should fall back to item.id. */
  sku: string | null;
  /** UPC/EAN/GTIN/ISBN barcode for POS and Google Shopping feeds. */
  barcode: string | null;
  title: string;
  description: string | null;
  photos: string[];
  priceCents: number;
  /** "Was" / strikethrough price in cents (Shopify compare_at_price). */
  compareAtPriceCents: number | null;
  quantity: number;
  variants: unknown;
  /** tracked | made_to_order */
  inventoryTracking?: string | null;
  status: string;
  /** new | used (used for eBay condition mapping). */
  condition: string | null;
  category: string | null;
  subcategory: string | null;
  secondaryCategory: string | null;
  /** Searchable tags (Shopify smart collections, storefront filters). */
  tags: string[];
  /** Manufacturer or brand name (Shopify vendor). */
  vendor: string | null;
  shippingCostCents: number | null;
  /** Whether shipping is disabled (digital products). */
  shippingDisabled?: boolean;
  /** Assigned package template used for Shippo and channel package fields. */
  package?: {
    source?: string | null;
    remoteProfileId?: string | null;
    shippingCostCents?: number | null;
    weightOz: number | null;
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
  } | null;
  etsyWhoMade: string | null;
  etsyWhenMade: string | null;
  etsyIsSupply: boolean | null;
  etsyTaxonomyId: number | null;
  ebayCategoryId: number | null;
  /** eBay Inventory API ConditionEnum override (category-specific). */
  ebayConditionEnum: string | null;
  /** Item specifics / product aspects: [{ name, value }]. Mapped to eBay product.aspects. */
  aspects: unknown;
  /** Used listings: allow buyer make-offer (INW marketplace + eBay Best Offer). */
  acceptOffers?: boolean;
  /** Auto-decline offers below this amount (cents); null = no minimum. */
  minOfferCents?: number | null;
};
export function getEffectiveSku(item: SyncStoreItem): string {
  return item.sku?.trim() || item.id;
}

/** A live connection with a fresh (decrypted, non-expired) access token. */
export type ChannelConnectionContext = {
  id: string;
  memberId: string;
  provider: ChannelProvider;
  externalShopId: string | null;
  accessToken: string;
  etsyShippingProfileId: string | null;
  /** OAuth scopes granted at connect time (space-separated). */
  scopes?: string | null;
  /** Provider-specific settings persisted on the connection (e.g. eBay policy ids + location). */
  config: Record<string, unknown> | null;
};

export type TokenResponse = {
  accessToken: string;
  refreshToken?: string | null;
  /** Seconds until the access token expires. */
  expiresInSec?: number | null;
  scopes?: string | null;
  /** Etsy includes the user_id in the token response. */
  userId?: string | null;
  /** Etsy may include a session-specific API key in the token response. */
  apiKey?: string | null;
};

export type RemoteListingSummary = {
  externalListingId: string;
  title: string;
  /** Remote SKU for the listing. */
  sku?: string | null;
  /** UPC/EAN/GTIN barcode from the remote listing. */
  barcode?: string | null;
  description: string | null;
  priceCents: number;
  /** "Was" / strikethrough price in cents. */
  compareAtPriceCents?: number | null;
  quantity: number;
  /** Shopify tags (comma-separated). */
  tags?: string[];
  /** Shopify vendor / brand name. */
  vendor?: string | null;
  /** False when the channel API did not return real stock (do not use qty for catalog reconcile). */
  quantityKnown?: boolean;
  photos: string[];
  url?: string;
  /** Channel-side last-modified time (used as the most-recent-wins tie-break in reconcile). */
  remoteUpdatedAt?: Date | null;
  /** True if this listing already maps to a StoreItem on INW. */
  alreadyLinked?: boolean;
  /** Remote browse category label (mapped to INW via fuzzy match on import). */
  category?: string | null;
  subcategory?: string | null;
  /** Provider taxonomy/collection id when available. */
  remoteCategoryId?: string | null;
  /** Flat per-item shipping in cents when the remote API exposes it. */
  shippingCostCents?: number | null;
  shippingKnown?: boolean;
  remoteShippingProfileId?: string | null;
  packageWeightOz?: number | null;
  packageLengthIn?: number | null;
  packageWidthIn?: number | null;
  packageHeightIn?: number | null;
  /** Normalized INW-shaped variant axes from the remote listing. */
  variants?: unknown;
  variantsKnown?: boolean;
  /** Item specifics parsed from the remote listing: [{ name, value }]. */
  aspects?: { name: string; value: string }[];
  aspectsKnown?: boolean;
  /** eBay Best Offer enabled on the remote listing. */
  acceptOffers?: boolean;
  /** eBay auto-decline floor in cents when known. */
  minOfferCents?: number | null;
  acceptOffersKnown?: boolean;
};

export type ChannelSyncResult = {
  provider: ChannelProvider;
  ok: boolean;
  error?: string;
  /** Remote listing exists even when ok is false (incomplete options). */
  remoteListingExists?: boolean;
  /**
   * Set when nothing was pushed because the guard intentionally declined (not an error and not a
   * completed push). Lets the UI avoid a false-green "synced" for a no-op.
   * - `remote_newer`: the shop's live copy is newer than INW and last-write-wins kept it.
   * - `paused`: this channel's sync direction is pull-only or paused, so nothing was pushed.
   * - `sync_disabled`: the seller's content sync toggles are all off.
   * - `no_qty_drift`: the channel already holds this exact quantity from our last successful push,
   *   so nothing was re-sent (prevents the every-tick re-push storm and qty snap-back).
   * - `pending_inbound`: eBay per-SKU GetItem is held for a second look; pushing would snap the seller edit.
   */
  skipped?: "remote_newer" | "paused" | "sync_disabled" | "no_qty_drift" | "pending_inbound";
};

/** A sale detected via webhook or reconciliation poll. */
export type RemoteSale = {
  /** Stable id used to dedupe (receipt/transaction/order id). */
  externalEventId: string;
  externalListingId: string;
  quantitySold: number;
  /** SKU set to the StoreItem id on publish; used for reverse lookup. */
  sku?: string | null;
  /** eBay Fulfillment `legacyItemId` (live Item ID) when the line has no inventory SKU. */
  legacyItemId?: string | null;
  /** Buyer-selected options when the channel exposes them (e.g. Size: M). */
  variant?: Record<string, string> | null;
};

export type NormalizedInboundEvent =
  | ({ kind: "sale" } & RemoteSale)
  | { kind: "listing_deleted"; externalEventId: string; externalListingId: string }
  | { kind: "ignored"; externalEventId?: string };

export type CreateListingResult = {
  externalListingId: string;
  externalShopId: string | null;
  /** False when a remote draft exists but is not live on the marketplace. */
  live?: boolean;
  warning?: string;
};

/**
 * Cross-provider listing/inventory surface used by the outbound push and inventory pooling.
 * OAuth + webhook parsing live alongside each adapter implementation.
 */
export interface ChannelAdapter {
  provider: ChannelProvider;

  // ---- OAuth ----
  getAuthUrl(args: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    /** Shopify only: normalized `{slug}.myshopify.com` host. */
    shop?: string;
    /** eBay only: pass "login" to force the sign-in screen when switching accounts. */
    prompt?: string;
  }): string;
  exchangeCode(args: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    /** Shopify only: normalized shop host used for token exchange. */
    shop?: string;
  }): Promise<TokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<TokenResponse>;
  fetchShopInfo(
    accessToken: string,
    options?: { shop?: string; userId?: string; apiKey?: string }
  ): Promise<{ shopId: string; shopName: string | null }>;
  /**
   * Optional one-time setup fetched right after the token exchange and persisted to
   * `ChannelConnection.config` (e.g. Etsy shipping profile, eBay policy ids + merchant location).
   */
  getInitialConfig?(
    accessToken: string,
    shopId: string
  ): Promise<Record<string, unknown>>;

  // ---- Listings (outbound: INW -> channel) ----
  createListing(conn: ChannelConnectionContext, item: SyncStoreItem): Promise<CreateListingResult>;
  updateListing(
    conn: ChannelConnectionContext,
    externalListingId: string,
    item: SyncStoreItem
  ): Promise<void>;
  deleteListing(conn: ChannelConnectionContext, externalListingId: string): Promise<void>;
  updateInventory(
    conn: ChannelConnectionContext,
    externalListingId: string,
    absoluteQuantity: number,
    item: SyncStoreItem
  ): Promise<void>;

  // ---- Import + reconciliation (inbound: channel -> INW) ----
  listRemoteListings(
    conn: ChannelConnectionContext,
    opts?: { skipPhotoEnrichment?: boolean }
  ): Promise<RemoteListingSummary[]>;
  /** Wix: read live stock for one product (v2/v1/v3). Other providers omit this. */
  fetchProductQuantity?(
    conn: ChannelConnectionContext,
    externalListingId: string
  ): Promise<{ quantity: number; known: boolean }>;
  fetchRecentSales(conn: ChannelConnectionContext, since: Date): Promise<RemoteSale[]>;

  // ---- Webhook (optional; reconciliation poll covers providers without webhooks) ----
  verifyWebhook?(rawBody: string, headers: Headers): boolean;
  parseInboundEvent?(payload: unknown, headers: Headers): NormalizedInboundEvent;
}
