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
  title: string;
  description: string | null;
  photos: string[];
  priceCents: number;
  quantity: number;
  variants: unknown;
  status: string;
  /** new | used (used for eBay condition mapping). */
  condition: string | null;
  shippingCostCents: number | null;
  etsyWhoMade: string | null;
  etsyWhenMade: string | null;
  etsyIsSupply: boolean | null;
  etsyTaxonomyId: number | null;
  ebayCategoryId: number | null;
};

/** A live connection with a fresh (decrypted, non-expired) access token. */
export type ChannelConnectionContext = {
  id: string;
  memberId: string;
  provider: ChannelProvider;
  externalShopId: string | null;
  accessToken: string;
  etsyShippingProfileId: string | null;
  /** Provider-specific settings persisted on the connection (e.g. eBay policy ids + location). */
  config: Record<string, unknown> | null;
};

export type TokenResponse = {
  accessToken: string;
  refreshToken?: string | null;
  /** Seconds until the access token expires. */
  expiresInSec?: number | null;
  scopes?: string | null;
};

export type RemoteListingSummary = {
  externalListingId: string;
  title: string;
  description: string | null;
  priceCents: number;
  quantity: number;
  /** False when the channel API did not return real stock (do not use qty for catalog reconcile). */
  quantityKnown?: boolean;
  photos: string[];
  url?: string;
  /** True if this listing already maps to a StoreItem on INW. */
  alreadyLinked?: boolean;
};

export type ChannelSyncResult = {
  provider: ChannelProvider;
  ok: boolean;
  error?: string;
};

/** A sale detected via webhook or reconciliation poll. */
export type RemoteSale = {
  /** Stable id used to dedupe (receipt/transaction/order id). */
  externalEventId: string;
  externalListingId: string;
  quantitySold: number;
  /** SKU set to the StoreItem id on publish; used for reverse lookup. */
  sku?: string | null;
};

export type NormalizedInboundEvent =
  | ({ kind: "sale" } & RemoteSale)
  | { kind: "listing_deleted"; externalEventId: string; externalListingId: string }
  | { kind: "ignored"; externalEventId?: string };

export type CreateListingResult = {
  externalListingId: string;
  externalShopId: string | null;
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
    options?: { shop?: string }
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
  listRemoteListings(conn: ChannelConnectionContext): Promise<RemoteListingSummary[]>;
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
