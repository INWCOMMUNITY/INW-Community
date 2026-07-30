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
type EtsyInventory = { products?: EtsyInventoryProduct[] };

function requireShop(conn: ChannelConnectionContext): string {
  if (!conn.externalShopId) throw new Error("Etsy connection is missing a shop id.");
  return conn.externalShopId;
}

function offeringPriceFloat(o: EtsyInventoryOffering, fallbackCents: number): number {
  if (typeof o.price === "number") return o.price;
  if (o.price && typeof o.price === "object" && o.price.amount && o.price.divisor) {
    return o.price.amount / o.price.divisor;
  }
  return Number(etsyPriceFromCents(fallbackCents));
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
    // The seller's first shipping profile is required to publish physical Etsy listings.
    try {
      const res = await etsyGet<{ results?: { shipping_profile_id: number }[] }>(
        accessToken,
        `/shops/${shopId}/shipping-profiles`
      );
      const id = res.results?.[0]?.shipping_profile_id;
      return { etsyShippingProfileId: id != null ? String(id) : null };
    } catch {
      return { etsyShippingProfileId: null };
    }
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
    await pushEtsyVariants(conn.accessToken, listingId, tid, item).catch((e) =>
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
    await etsyForm(
      conn.accessToken,
      `/shops/${shopId}/listings/${externalListingId}`,
      "PATCH",
      buildEtsyUpdateFields(item, {
        taxonomyId: item.etsyTaxonomyId ?? cat.etsyTaxonomyId,
        shippingProfileId,
      })
    );
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
    const inv = await etsyGet<EtsyInventory>(
      conn.accessToken,
      `/listings/${externalListingId}/inventory`
    );
    const products = inv.products ?? [];
    if (products.length === 0) {
      // No inventory record: fall back to the listing-level quantity field.
      const shopId = requireShop(conn);
      await etsyForm(conn.accessToken, `/shops/${shopId}/listings/${externalListingId}`, "PATCH", {
        quantity: Math.max(0, absoluteQuantity),
      });
      return;
    }

    const optionQtys = optionQuantityMap(item.variants);
    const singleProduct = products.length === 1;

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
      const offerings = (p.offerings ?? []).map((o) => {
        const quantity =
          matchedQty != null
            ? matchedQty
            : singleProduct
              ? Math.max(0, absoluteQuantity)
              : Math.max(0, o.quantity ?? 0);
        return {
          quantity,
          price: offeringPriceFloat(o, item.priceCents),
          is_enabled: quantity > 0,
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
          },
        ],
      };
    });

    await etsyJson(conn.accessToken, `/listings/${externalListingId}/inventory`, "PUT", {
      products: rebuilt,
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
