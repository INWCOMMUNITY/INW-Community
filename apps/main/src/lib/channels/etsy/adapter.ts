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
import { etsyForm, etsyGet, etsyUploadImage, setEtsyConnectionContext } from "./client";
import { applyEtsySellOutInventory, endEtsyListing } from "./end-listing";
import { exchangeEtsyCode, fetchEtsyShopInfo, getEtsyAuthUrl, refreshEtsyToken } from "./oauth";
import { resolveProviderCategoryId } from "../category-map";
import {
  fetchEtsyShippingProfiles,
  pickPreferredEtsyShippingProfile,
  resolveEtsyShippingProfile,
  resolveEtsyShippingProfileId,
  shippingProfileIdForEtsyUpdate,
} from "../shipping-map";
import { resolveEtsyReadinessStateId } from "./readiness";
import {
  buildEtsyCreateFields,
  buildEtsyUpdateFields,
  etsyListingToSummary,
} from "./mapping";
import { pushEtsyVariants, syncEtsyListingInventoryFromInw } from "./variants";
import { prisma } from "database";
import { hasOptionQuantities } from "@/lib/store-item-variants";
import { parseEtsyInboundEvent, verifyEtsyWebhook } from "./webhook";
import { readLastPushedPhotos, syncEtsyListingPhotos } from "./photos";
import {
  startTrace,
  addInputSnapshot,
  addValidation,
  addRequest,
  addResponse,
  completeTrace,
  type ValidationCheck,
} from "../sync-trace";

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

    // Prefer a flat/manual profile. Calculated profiles need package weight and size.
    try {
      const profiles = await fetchEtsyShippingProfiles(accessToken, shopId);
      const picked = pickPreferredEtsyShippingProfile(profiles);
      etsyShippingProfileId =
        picked?.shipping_profile_id != null ? String(picked.shipping_profile_id) : null;
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
    setEtsyConnectionContext(conn.id);

    // Start trace
    const trace = startTrace(conn.memberId, "etsy", item.id, "create", {
      sku: item.sku ?? item.id,
      categoryId: item.etsyTaxonomyId?.toString() ?? null,
    });

    addInputSnapshot(trace, {
      title: item.title,
      priceCents: item.priceCents,
      quantity: item.quantity,
      status: item.status,
      etsyTaxonomyId: item.etsyTaxonomyId,
      etsyWhoMade: item.etsyWhoMade,
      etsyWhenMade: item.etsyWhenMade,
      etsyIsSupply: item.etsyIsSupply,
    });

    try {
      const validationChecks: ValidationCheck[] = [];
      
      const taxonomyId =
        item.etsyTaxonomyId ??
        (await resolveProviderCategoryId(conn, "etsy", item.category)).etsyTaxonomyId;
      const shippingProfileId =
        item.package?.source === "etsy" && item.package.remoteProfileId
          ? item.package.remoteProfileId
          : await resolveEtsyShippingProfileId(conn, item.shippingCostCents);
      const readinessStateId = await resolveEtsyReadinessStateId(conn, shopId);

      // Validate required Etsy fields
      validationChecks.push({
        name: "who_made",
        passed: !!item.etsyWhoMade,
        detail: item.etsyWhoMade || "Not set",
        severity: "error",
      });
      validationChecks.push({
        name: "when_made",
        passed: !!item.etsyWhenMade,
        detail: item.etsyWhenMade || "Not set",
        severity: "error",
      });
      validationChecks.push({
        name: "taxonomy",
        passed: !!taxonomyId,
        detail: taxonomyId ? `ID: ${taxonomyId}` : "Not set",
        severity: "error",
      });
      validationChecks.push({
        name: "shipping_profile",
        passed: !!(shippingProfileId ?? conn.etsyShippingProfileId),
        detail: shippingProfileId ? "Configured" : "Using default",
        severity: "warning",
      });
      validationChecks.push({
        name: "readiness_state",
        passed: readinessStateId > 0,
        detail: `ID: ${readinessStateId}`,
        severity: "error",
      });

      const allValid = validationChecks.every((c) => c.passed || c.severity === "warning");
      addValidation(trace, { valid: allValid, checks: validationChecks });

      const createFields = buildEtsyCreateFields(item, conn, {
        taxonomyId: taxonomyId ?? undefined,
        shippingProfileId,
        readinessStateId,
      });
      addRequest(trace, createFields as Record<string, unknown>);

      const created = await etsyForm<{ listing_id: number }>(
        conn.accessToken,
        `/shops/${shopId}/listings`,
        "POST",
        createFields
      );
      const listingId = String(created.listing_id);
      addResponse(trace, 200, { listing_id: created.listing_id });

      let rank = 1;
      for (const url of item.photos.slice(0, 10)) {
        try {
          await etsyUploadImage(conn.accessToken, shopId, listingId, url, rank);
          rank += 1;
        } catch (e) {
          console.error("[etsy] image upload failed", { listingId, url, error: String(e) });
        }
      }

      const resolvedTaxonomyId = taxonomyId ?? item.etsyTaxonomyId;
      if (!resolvedTaxonomyId) {
        const error = new Error(
          "Etsy requires a category before listing. Choose an Etsy category on the item."
        );
        await completeTrace(trace, "validation_failed", error);
        throw error;
      }

      await pushEtsyVariants(conn.accessToken, listingId, resolvedTaxonomyId, item, readinessStateId).catch((e) =>
        console.error("[etsy] variant push failed", { listingId, error: String(e) })
      );
      await this.updateInventory(conn, listingId, item.quantity, item).catch((e) =>
        console.error("[etsy] initial inventory set failed", { listingId, error: String(e) })
      );

      const profileForPublish = shippingProfileId ?? conn.etsyShippingProfileId;
      if (!profileForPublish) {
        await completeTrace(trace, "success");
        return {
          externalListingId: listingId,
          externalShopId: shopId,
          live: false,
          warning:
            "Created as an Etsy draft — add a shipping profile in Sync Stores to go live.",
        };
      }
      if (item.status === "active" && item.quantity > 0) {
        try {
          await etsyForm(conn.accessToken, `/shops/${shopId}/listings/${listingId}`, "PATCH", {
            state: "active",
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[etsy] publish failed", { listingId, error: msg });
          await completeTrace(trace, "success");
          return {
            externalListingId: listingId,
            externalShopId: shopId,
            live: false,
            warning: `Created as an Etsy draft — it could not go live. ${msg.slice(0, 180)}`,
          };
        }
      } else {
        await completeTrace(trace, "success");
        return {
          externalListingId: listingId,
          externalShopId: shopId,
          live: false,
          warning: "Created as an Etsy draft — it is not live yet.",
        };
      }

      await completeTrace(trace, "success");
      return { externalListingId: listingId, externalShopId: shopId, live: true };
    } catch (e) {
      await completeTrace(trace, "failed", e);
      throw e;
    }
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    const shopId = requireShop(conn);
    setEtsyConnectionContext(conn.id);

    // Start trace
    const trace = startTrace(conn.memberId, "etsy", item.id, "update", {
      sku: item.sku ?? item.id,
      categoryId: item.etsyTaxonomyId?.toString() ?? null,
    });

    addInputSnapshot(trace, {
      title: item.title,
      priceCents: item.priceCents,
      quantity: item.quantity,
      status: item.status,
      etsyTaxonomyId: item.etsyTaxonomyId,
      etsyWhoMade: item.etsyWhoMade,
      etsyWhenMade: item.etsyWhenMade,
      etsyIsSupply: item.etsyIsSupply,
    });

    try {
      const validationChecks: ValidationCheck[] = [];

      const taxonomyId =
        item.etsyTaxonomyId ??
        (await resolveProviderCategoryId(conn, "etsy", item.category)).etsyTaxonomyId;
      const shipping = await resolveEtsyShippingProfile(conn, item.shippingCostCents);
      const packageComplete = Boolean(
        item.package &&
          item.package.weightOz &&
          item.package.lengthIn &&
          item.package.widthIn &&
          item.package.heightIn
      );
      const fromOption =
        item.package?.source === "etsy" && item.package.remoteProfileId
          ? item.package.remoteProfileId
          : null;
      const shippingProfileId = fromOption
        ? fromOption
        : packageComplete
          ? shipping.shippingProfileId
          : shippingProfileIdForEtsyUpdate(shipping);
      if (shipping.isCalculated && shipping.shippingProfileId && !packageComplete && !fromOption) {
        console.log("[etsy] skip calculated shipping_profile_id on update", {
          listingId: externalListingId,
          shippingProfileId: shipping.shippingProfileId,
        });
      }
      
      // Validate required Etsy fields
      validationChecks.push({
        name: "who_made",
        passed: !!item.etsyWhoMade,
        detail: item.etsyWhoMade || "Not set",
        severity: "warning",
      });
      validationChecks.push({
        name: "when_made",
        passed: !!item.etsyWhenMade,
        detail: item.etsyWhenMade || "Not set",
        severity: "warning",
      });

      addValidation(trace, { valid: true, checks: validationChecks });
      
      const updateFields = buildEtsyUpdateFields(item, {
        taxonomyId,
        shippingProfileId,
      });
      addRequest(trace, updateFields as Record<string, unknown>);

      await etsyForm(
        conn.accessToken,
        `/shops/${shopId}/listings/${externalListingId}`,
        "PATCH",
        updateFields
      );
      addResponse(trace, 200, { success: true });

      const syncPhotosPref = await prisma.memberSyncPreferences.findUnique({
        where: { memberId: conn.memberId },
        select: { syncPhotos: true },
      });
      if (syncPhotosPref?.syncPhotos !== false) {
        const etsyLink = await prisma.channelListingLink.findFirst({
          where: { storeItemId: item.id, provider: "etsy" },
          select: { lastPushedPhotos: true },
        });
        await syncEtsyListingPhotos({
          accessToken: conn.accessToken,
          shopId,
          listingId: externalListingId,
          inwPhotos: item.photos,
          lastPushedInwPhotos: readLastPushedPhotos(etsyLink?.lastPushedPhotos),
        }).catch((e) => {
          console.error("[etsy] photo sync failed", {
            listingId: externalListingId,
            error: String(e),
          });
        });
      }

      if (item.quantity <= 0 || item.status === "sold_out") {
        await applyEtsySellOutInventory({
          accessToken: conn.accessToken,
          shopId,
          listingId: externalListingId,
          connectionId: conn.id,
          tryListingQuantityZero: !hasOptionQuantities(item.variants),
        });
      } else {
        await this.updateInventory(conn, externalListingId, item.quantity, item);
      }

      await completeTrace(trace, "success");
    } catch (e) {
      await completeTrace(trace, "failed", e);
      throw e;
    }
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    const shopId = requireShop(conn);
    await endEtsyListing({
      accessToken: conn.accessToken,
      shopId,
      listingId: externalListingId,
      connectionId: conn.id,
    });
  },

  async updateInventory(conn, externalListingId, absoluteQuantity, item): Promise<void> {
    const shopId = requireShop(conn);
    setEtsyConnectionContext(conn.id);
    const inv = await etsyGet<EtsyInventory>(
      conn.accessToken,
      `/listings/${externalListingId}/inventory`
    ).catch(() => ({ products: [] as EtsyInventoryProduct[] }));
    const products = inv.products ?? [];

    if (absoluteQuantity <= 0) {
      await applyEtsySellOutInventory({
        accessToken: conn.accessToken,
        shopId,
        listingId: externalListingId,
        connectionId: conn.id,
        tryListingQuantityZero: products.length === 0 && !hasOptionQuantities(item.variants),
      });
      return;
    }

    if (products.length === 0 && !hasOptionQuantities(item.variants)) {
      await etsyForm(conn.accessToken, `/shops/${shopId}/listings/${externalListingId}`, "PATCH", {
        quantity: Math.max(0, absoluteQuantity),
      });
      return;
    }

    let defaultReadinessStateId: number | null = null;
    try {
      defaultReadinessStateId = await resolveEtsyReadinessStateId(conn, shopId);
    } catch (e) {
      console.warn("[etsy] failed to fetch processing profiles on-demand", { error: String(e) });
    }

    await syncEtsyListingInventoryFromInw(
      conn.accessToken,
      externalListingId,
      item,
      absoluteQuantity,
      defaultReadinessStateId
    );

    if (products.length <= 1 && !hasOptionQuantities(item.variants)) {
      const after = await etsyGet<EtsyInventory>(
        conn.accessToken,
        `/listings/${externalListingId}/inventory`
      ).catch(() => null);
      const actual = after?.products?.[0]?.offerings?.[0]?.quantity;
      const want = Math.max(0, absoluteQuantity);
      if (want > 0 && typeof actual === "number" && actual !== want) {
        throw new Error(
          `Etsy inventory verify failed for listing ${externalListingId}: expected ${want}, got ${actual}`
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
      // Cap at 5 pages (500 listings) to stay within rate limits.
      for (let page = 0; page < 5; page += 1) {
        const res = await etsyGet<{ results?: Parameters<typeof etsyListingToSummary>[0][]; count?: number }>(
          conn.accessToken,
          `/shops/${shopId}/listings?state=${state}&limit=100&offset=${offset}&includes=Images`
        ).catch(() => null);
        const results = res?.results ?? [];
        
        for (const l of results) {
          // Basic summary from listing endpoint - no extra API calls needed
          // The listing endpoint already includes title, description, price, quantity, images
          const summary = etsyListingToSummary(l);
          out.push(summary);
        }
        
        if (results.length < 100) break;
        offset += 100;
      }
    }
    
    // NOTE: We intentionally skip taxonomy and inventory fetches during sync polling.
    // - Taxonomy: Cached at import time, doesn't change frequently
    // - Inventory: Only needed for variant-specific quantities, fetched on-demand
    // This reduces API calls from O(n) to O(1) per 100 listings.
    
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
