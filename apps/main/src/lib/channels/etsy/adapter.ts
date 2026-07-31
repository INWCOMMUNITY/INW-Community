import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  NormalizedInboundEvent,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import { EtsyApiError, etsyDelete, etsyForm, etsyGet, etsyJson, etsyUploadImage } from "./client";
import { exchangeEtsyCode, fetchEtsyShopInfo, getEtsyAuthUrl, refreshEtsyToken } from "./oauth";
import { resolveProviderCategoryId } from "../category-map";
import { resolveEtsyShippingProfileId } from "../shipping-map";
import {
  buildEtsyCreateFields,
  buildEtsyUpdateFields,
  etsyListingToSummary,
  etsyPriceFromCents,
} from "./mapping";
import { pushEtsyVariants, etsyInventoryToVariants } from "./variants";
import { parseEtsyInboundEvent, verifyEtsyWebhook } from "./webhook";

type EtsyInventoryOffering = {
  offering_id?: number;
  quantity?: number;
  price?: { amount?: number; divisor?: number } | number;
  is_enabled?: boolean;
  readiness_state_id?: number | null;
};
type EtsyInventoryProduct = {
  product_id?: number;
  sku?: string;
  property_values?: {
    property_id?: number;
    property_name?: string;
    scale_id?: number | null;
    value_ids?: number[];
    values?: string[];
  }[];
  offerings?: EtsyInventoryOffering[];
};
type EtsyInventory = {
  products?: EtsyInventoryProduct[];
  // These arrays track which properties affect price/quantity/sku/readiness
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
  readiness_state_on_property?: number[];
};

function requireShop(conn: ChannelConnectionContext): string {
  if (!conn.externalShopId) throw new Error("Etsy connection is missing a shop id.");
  return conn.externalShopId;
}

/**
 * Get the price for an offering. 
 * ALWAYS uses the INW price (itemPriceCents) to ensure price edits sync properly.
 * The offering's existing price is only used as a reference for logging.
 */
function offeringPriceFloat(itemPriceCents: number): number {
  // Always use the INW item's price to ensure price changes sync correctly
  return Number(etsyPriceFromCents(itemPriceCents));
}

/** Lowercased option value -> quantity, for option-quantity variant listings. */
function optionQuantityMap(variants: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(variants)) return map;
  for (const v of variants as { options?: unknown[] }[]) {
    if (!Array.isArray(v?.options)) continue;
    for (const o of v.options) {
      if (o && typeof o === "object" && "value" in o && "quantity" in o) {
        const value = String((o as { value: unknown }).value).trim().toLowerCase();
        const qty = Number((o as { quantity: unknown }).quantity);
        if (value && Number.isFinite(qty)) map.set(value, Math.max(0, qty));
      }
    }
  }
  return map;
}

type EtsyImage = {
  listing_image_id: number;
  url_fullxfull?: string;
  url_570xN?: string;
  rank: number;
};

/**
 * Sync photos from INW to Etsy listing.
 * Compares current Etsy images with INW photos and:
 * - Uploads new photos that don't exist on Etsy
 * - Deletes Etsy images that are no longer in INW
 * 
 * Note: This uses URL comparison which may not be perfect for all cases,
 * but handles the common case of photo additions/removals.
 */
async function syncEtsyPhotos(
  accessToken: string,
  shopId: string,
  listingId: string,
  inwPhotos: string[]
): Promise<void> {
  if (inwPhotos.length === 0) {
    // Don't delete all photos - Etsy requires at least one
    return;
  }

  // Get current Etsy images
  let etsyImages: EtsyImage[] = [];
  try {
    const listing = await etsyGet<{ images?: EtsyImage[] }>(
      accessToken,
      `/listings/${listingId}?includes=Images`
    );
    etsyImages = listing.images ?? [];
  } catch {
    // Can't get current images, skip sync
    return;
  }

  // Extract Etsy image URLs for comparison
  const etsyUrls = new Set(
    etsyImages.map((img) => img.url_fullxfull || img.url_570xN || "").filter(Boolean)
  );

  // Find photos that need to be uploaded (in INW but not on Etsy)
  const toUpload = inwPhotos.filter((url) => {
    // Check if any Etsy URL contains similar path (URLs may differ in domain/size)
    const urlPath = new URL(url).pathname;
    return ![...etsyUrls].some((etsyUrl) => {
      try {
        return new URL(etsyUrl).pathname.includes(urlPath.split("/").pop() || "___nomatch___");
      } catch {
        return false;
      }
    });
  });

  // Upload new photos
  if (toUpload.length > 0) {
    console.log("[etsy] uploading new photos", { listingId, count: toUpload.length });
    let rank = etsyImages.length + 1;
    for (const url of toUpload.slice(0, 10 - etsyImages.length)) {
      try {
        await etsyUploadImage(accessToken, shopId, listingId, url, rank);
        rank++;
      } catch (e) {
        console.error("[etsy] photo upload failed", { listingId, url, error: String(e) });
      }
    }
  }

  // Note: We don't delete photos automatically to avoid accidentally removing
  // images that the seller added directly on Etsy. If needed, this can be added
  // with a flag to enable destructive photo sync.
}

export const etsyAdapter: ChannelAdapter = {
  provider: "etsy",

  getAuthUrl: getEtsyAuthUrl,

  exchangeCode(args): Promise<TokenResponse> {
    return exchangeEtsyCode(args);
  },

  refreshAccessToken(refreshToken): Promise<TokenResponse> {
    return refreshEtsyToken(refreshToken);
  },

  fetchShopInfo(accessToken, options) {
    return fetchEtsyShopInfo(accessToken, options);
  },

  async getInitialConfig(accessToken, shopId): Promise<Record<string, unknown>> {
    let etsyShippingProfileId: string | null = null;
    let defaultReadinessStateId: number | null = null;

    // The seller's first shipping profile is required to publish physical Etsy listings.
    try {
      const res = await etsyGet<{ results?: { shipping_profile_id: number }[] }>(
        accessToken,
        `/shops/${shopId}/shipping-profiles`
      );
      const id = res.results?.[0]?.shipping_profile_id;
      etsyShippingProfileId = id != null ? String(id) : null;
    } catch {
      /* ignore - shipping profile is optional for initial config */
    }

    // Fetch processing profiles for readiness_state_id (required for physical listings since 2025).
    try {
      const profiles = await etsyGet<{ results?: { readiness_state_id: number }[] }>(
        accessToken,
        `/shops/${shopId}/readiness-state-definitions`
      );
      defaultReadinessStateId = profiles.results?.[0]?.readiness_state_id ?? null;
      console.log("[etsy] fetched processing profiles", {
        shopId,
        count: profiles.results?.length ?? 0,
        defaultReadinessStateId,
      });
    } catch (e) {
      console.warn("[etsy] failed to fetch processing profiles", { shopId, error: String(e) });
    }

    return { etsyShippingProfileId, defaultReadinessStateId };
  },

  async createListing(conn, item): Promise<CreateListingResult> {
    const shopId = requireShop(conn);
    const cat = await resolveProviderCategoryId(conn, "etsy", item.category);
    const taxonomyId = item.etsyTaxonomyId ?? cat.etsyTaxonomyId;
    const shippingProfileId = await resolveEtsyShippingProfileId(conn, item.shippingCostCents);
    const created = await etsyForm<{ listing_id: number }>(
      conn.accessToken,
      `/shops/${shopId}/listings`,
      "POST",
      buildEtsyCreateFields(item, conn, {
        taxonomyId: taxonomyId ?? undefined,
        shippingProfileId,
      })
    );
    const listingId = String(created.listing_id);

    let rank = 1;
    for (const url of item.photos.slice(0, 10)) {
      try {
        await etsyUploadImage(conn.accessToken, shopId, listingId, url, rank);
        rank += 1;
      } catch (e) {
        console.error("[etsy] image upload failed", { listingId, url, error: String(e) });
      }
    }

    const tid = taxonomyId ?? 1;
    // Get the default readiness_state_id from connection config, or fetch on-demand
    let defaultReadinessStateId =
      typeof conn.config?.defaultReadinessStateId === "number"
        ? conn.config.defaultReadinessStateId
        : null;
    
    // If no defaultReadinessStateId in config, fetch on-demand (required for physical listings)
    if (defaultReadinessStateId == null) {
      try {
        const profiles = await etsyGet<{ results?: { readiness_state_id: number }[] }>(
          conn.accessToken,
          `/shops/${shopId}/readiness-state-definitions`
        );
        defaultReadinessStateId = profiles.results?.[0]?.readiness_state_id ?? null;
        console.log("[etsy] fetched processing profiles on-demand for createListing", {
          shopId,
          listingId,
          defaultReadinessStateId,
        });
      } catch (e) {
        console.warn("[etsy] failed to fetch processing profiles on-demand", { error: String(e) });
      }
    }

    await pushEtsyVariants(conn.accessToken, listingId, tid, item, defaultReadinessStateId).catch((e) =>
      console.error("[etsy] variant push failed", { listingId, error: String(e) })
    );
    await this.updateInventory(conn, listingId, item.quantity, item).catch((e) =>
      console.error("[etsy] initial inventory set failed", { listingId, error: String(e) })
    );

    const profileForPublish = shippingProfileId ?? conn.etsyShippingProfileId;
    if (item.status === "active" && item.quantity > 0 && profileForPublish) {
      await etsyForm(conn.accessToken, `/shops/${shopId}/listings/${listingId}`, "PATCH", {
        state: "active",
      }).catch((e) => console.error("[etsy] publish failed", { listingId, error: String(e) }));
    }

    return { externalListingId: listingId, externalShopId: shopId };
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    const shopId = requireShop(conn);
    const cat = await resolveProviderCategoryId(conn, "etsy", item.category);
    const shippingProfileId = await resolveEtsyShippingProfileId(conn, item.shippingCostCents);
    
    // Update listing fields (title, description, price, taxonomy, who_made, when_made, etc.)
    await etsyForm(
      conn.accessToken,
      `/shops/${shopId}/listings/${externalListingId}`,
      "PATCH",
      buildEtsyUpdateFields(item, {
        taxonomyId: item.etsyTaxonomyId ?? cat.etsyTaxonomyId,
        shippingProfileId,
      })
    );

    // Sync photos if they've changed
    await syncEtsyPhotos(conn.accessToken, shopId, externalListingId, item.photos).catch((e) => {
      console.error("[etsy] photo sync failed", { listingId: externalListingId, error: String(e) });
    });

    // Note: We do NOT call pushEtsyVariants here because it tries to REPLACE the entire
    // inventory structure. Etsy listings may already have variants with different property_ids.
    // Instead, updateInventory properly reads existing inventory and updates quantities/prices
    // while preserving the existing variant structure.
    await this.updateInventory(conn, externalListingId, item.quantity, item);
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    try {
      await etsyDelete(conn.accessToken, `/listings/${externalListingId}`);
    } catch (e) {
      // Already gone on Etsy is a success for our purposes.
      if (e instanceof EtsyApiError && e.status === 404) return;
      throw e;
    }
  },

  async updateInventory(conn, externalListingId, absoluteQuantity, item): Promise<void> {
    const shopId = requireShop(conn);
    const inv = await etsyGet<EtsyInventory>(
      conn.accessToken,
      `/listings/${externalListingId}/inventory`
    );
    const products = inv.products ?? [];
    if (products.length === 0) {
      // No inventory record: fall back to the listing-level quantity field.
      await etsyForm(conn.accessToken, `/shops/${shopId}/listings/${externalListingId}`, "PATCH", {
        quantity: Math.max(0, absoluteQuantity),
      });
      return;
    }

    // Get the default readiness_state_id from connection config, or fetch on-demand
    let defaultReadinessStateId =
      typeof conn.config?.defaultReadinessStateId === "number"
        ? conn.config.defaultReadinessStateId
        : null;

    // If no defaultReadinessStateId in config, try to fetch it on-demand
    if (defaultReadinessStateId == null) {
      try {
        const profiles = await etsyGet<{ results?: { readiness_state_id: number }[] }>(
          conn.accessToken,
          `/shops/${shopId}/readiness-state-definitions`
        );
        defaultReadinessStateId = profiles.results?.[0]?.readiness_state_id ?? null;
        console.log("[etsy] fetched processing profiles on-demand", {
          shopId,
          defaultReadinessStateId,
        });
      } catch (e) {
        console.warn("[etsy] failed to fetch processing profiles on-demand", { error: String(e) });
      }
    }

    const optionQtys = optionQuantityMap(item.variants);
    const singleProduct = products.length === 1;

    // Check if quantity varies by property - if not, all products must have the same quantity
    const quantityOnProperty = inv.quantity_on_property ?? [];
    const quantityVariesByProperty = quantityOnProperty.length > 0;

    const rebuilt = products.map((p) => {
      const propValues = p.property_values ?? [];
      const matchedQty = (() => {
        if (optionQtys.size === 0) return null;
        for (const pv of propValues) {
          for (const val of pv.values ?? []) {
            const q = optionQtys.get(String(val).trim().toLowerCase());
            if (q != null) return q;
          }
        }
        return null;
      })();

      // Determine quantity based on whether it varies by property
      let quantity: number;
      if (quantityVariesByProperty && matchedQty != null) {
        // Quantity varies by property and we have a matched variant quantity
        quantity = matchedQty;
      } else if (singleProduct || !quantityVariesByProperty) {
        // Single product OR quantity doesn't vary by property - use absolute quantity
        quantity = Math.max(0, absoluteQuantity);
      } else {
        // Multi-product with quantity on property but no match - preserve existing
        quantity = Math.max(0, (p.offerings?.[0]?.quantity ?? 0));
      }

      const offerings = (p.offerings ?? []).map((o) => {
        // Preserve existing readiness_state_id or fall back to shop default
        const readinessStateId = o.readiness_state_id ?? defaultReadinessStateId;
        return {
          quantity,
          price: offeringPriceFloat(item.priceCents),
          is_enabled: quantity > 0,
          // Include readiness_state_id - required for physical listings since summer 2025
          ...(readinessStateId != null ? { readiness_state_id: readinessStateId } : {}),
        };
      });
      return {
        sku: p.sku || item.id,
        property_values: propValues.map((pv) => ({
          property_id: pv.property_id,
          property_name: pv.property_name || "Option",
          value_ids: pv.value_ids ?? [],
          values: pv.values ?? [],
          ...(pv.scale_id != null ? { scale_id: pv.scale_id } : {}),
        })),
        offerings: offerings.length > 0 ? offerings : [
          {
            quantity: Math.max(0, absoluteQuantity),
            price: Number(etsyPriceFromCents(item.priceCents)),
            is_enabled: absoluteQuantity > 0,
            ...(defaultReadinessStateId != null ? { readiness_state_id: defaultReadinessStateId } : {}),
          },
        ],
      };
    });

    console.log("[etsy] updating inventory", {
      listingId: externalListingId,
      productCount: rebuilt.length,
      defaultReadinessStateId,
      quantityOnProperty,
      quantityVariesByProperty,
      hasReadinessIds: rebuilt.some((p) =>
        p.offerings.some((o: { readiness_state_id?: number }) => o.readiness_state_id != null)
      ),
    });

    // Preserve the original property arrays from the GET response
    await etsyJson(conn.accessToken, `/listings/${externalListingId}/inventory`, "PUT", {
      products: rebuilt,
      // Preserve original property arrays to maintain Etsy's inventory structure
      ...(inv.price_on_property?.length ? { price_on_property: inv.price_on_property } : {}),
      ...(inv.quantity_on_property?.length ? { quantity_on_property: inv.quantity_on_property } : {}),
      ...(inv.sku_on_property?.length ? { sku_on_property: inv.sku_on_property } : {}),
      ...(inv.readiness_state_on_property?.length ? { readiness_state_on_property: inv.readiness_state_on_property } : {}),
    });

    // Read-back verify for single-SKU listings
    if (singleProduct) {
      const after = await etsyGet<EtsyInventory>(
        conn.accessToken,
        `/listings/${externalListingId}/inventory`
      ).catch(() => null);
      const actual = after?.products?.[0]?.offerings?.[0]?.quantity;
      if (typeof actual === "number" && actual !== Math.max(0, absoluteQuantity)) {
        throw new Error(
          `Etsy inventory verify failed for listing ${externalListingId}: expected ${absoluteQuantity}, got ${actual}`
        );
      }
    }
  },

  async fetchProductQuantity(
    conn,
    externalListingId
  ): Promise<{ quantity: number; known: boolean }> {
    try {
      const inv = await etsyGet<EtsyInventory>(
        conn.accessToken,
        `/listings/${externalListingId}/inventory`
      );
      const products = inv.products ?? [];
      if (products.length === 0) {
        const listing = await etsyGet<{ quantity?: number }>(
          conn.accessToken,
          `/listings/${externalListingId}`
        );
        if (typeof listing.quantity === "number") {
          return { quantity: Math.max(0, listing.quantity), known: true };
        }
        return { quantity: 0, known: false };
      }
      let total = 0;
      for (const p of products) {
        for (const o of p.offerings ?? []) {
          total += Math.max(0, o.quantity ?? 0);
        }
      }
      return { quantity: total, known: true };
    } catch {
      return { quantity: 0, known: false };
    }
  },

  async listRemoteListings(conn): Promise<RemoteListingSummary[]> {
    const shopId = requireShop(conn);
    const out: RemoteListingSummary[] = [];
    // Active only — draft/inactive treated as removed by baseline reconciler.
    const states = ["active"];
    for (const state of states) {
      let offset = 0;
      // Cap the import preview at a few pages to stay within rate limits.
      for (let page = 0; page < 5; page += 1) {
        const res = await etsyGet<{ results?: Parameters<typeof etsyListingToSummary>[0][]; count?: number }>(
          conn.accessToken,
          `/shops/${shopId}/listings?state=${state}&limit=100&offset=${offset}&includes=Images`
        ).catch(() => null);
        const results = res?.results ?? [];
        for (const l of results) {
          const summary = etsyListingToSummary(l);
          if (l.taxonomy_id) {
            try {
              const tax = await etsyGet<{ name?: string; path?: string[] }>(
                conn.accessToken,
                `/application/seller-taxonomy/nodes/${l.taxonomy_id}`
              ).catch(() => null);
              // Etsy path is root → … → leaf. Use root as category + leaf as subcategory
              // so auto-translate hits top-level aliases (Accessories, Home & Living, …).
              const path = tax?.path ?? (tax?.name ? [tax.name] : []);
              if (path.length > 0) {
                summary.category = path[0] ?? null;
                summary.subcategory =
                  path.length > 1 ? path[path.length - 1] ?? null : null;
              }
            } catch {
              /* optional enrichment */
            }
          }
          try {
            const inv = await etsyGet<EtsyInventory>(
              conn.accessToken,
              `/listings/${l.listing_id}/inventory`
            );
            const vars = etsyInventoryToVariants(inv.products);
            if (vars) {
              summary.variants = vars;
              summary.variantsKnown = true;
            }
            // Get price from first offering (more accurate than listing-level price for variants)
            const firstOffering = inv.products?.[0]?.offerings?.[0];
            if (firstOffering?.price) {
              const offeringPrice = firstOffering.price;
              if (typeof offeringPrice === "number") {
                // Price is already in dollars
                summary.priceCents = Math.round(offeringPrice * 100);
              } else if (offeringPrice.amount && offeringPrice.divisor) {
                // Price is {amount, divisor} format
                summary.priceCents = Math.round((offeringPrice.amount / offeringPrice.divisor) * 100);
              }
            }
          } catch {
            /* inventory optional on list */
          }
          out.push(summary);
        }
        if (results.length < 100) break;
        offset += 100;
      }
    }
    return out;
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
    const shopId = requireShop(conn);
    const minCreated = Math.floor(since.getTime() / 1000);
    const sales: RemoteSale[] = [];
    let offset = 0;
    for (let page = 0; page < 5; page += 1) {
      const res = await etsyGet<{
        results?: {
          receipt_id: number;
          transactions?: { transaction_id: number; listing_id: number; quantity: number; sku?: string }[];
        }[];
      }>(
        conn.accessToken,
        `/shops/${shopId}/receipts?min_created=${minCreated}&limit=100&offset=${offset}`
      ).catch(() => null);
      const results = res?.results ?? [];
      for (const r of results) {
        for (const t of r.transactions ?? []) {
          sales.push({
            externalEventId: `receipt:${r.receipt_id}:tx:${t.transaction_id}`,
            externalListingId: String(t.listing_id),
            quantitySold: Math.max(1, t.quantity ?? 1),
            sku: t.sku ?? null,
          });
        }
      }
      if (results.length < 100) break;
      offset += 100;
    }
    return sales;
  },

  verifyWebhook(rawBody, headers): boolean {
    return verifyEtsyWebhook(rawBody, headers);
  },

  parseInboundEvent(payload, headers): NormalizedInboundEvent {
    return parseEtsyInboundEvent(payload, headers);
  },
};
