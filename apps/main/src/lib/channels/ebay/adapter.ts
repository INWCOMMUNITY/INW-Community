import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import { ebayFulfillmentLineToSale } from "../sale-link";
import { classifyEbayUpsertResult } from "./upsert-outcome";
import { EbayApiError, ebayAction, ebayGet, ebayGetInventoryItem, ebayJson, takeEbayCallWarnings } from "./client";
import {
  describeEbayThrownError,
  formatEbayErrorDiagnostics,
  isEbayInventoryAspectValidationError,
  isEbayOfferLookupMiss,
  isEbayUnpublishedZeroQuantityError,
} from "./errors";
import {
  exchangeEbayCode,
  fetchEbayShopInfo,
  getEbayAuthUrl,
  refreshEbayToken,
} from "./oauth";
import { fetchEbayConnectionConfig, readEbayConfig } from "./account";
import { enrichInventoryBodyWithCatalogProduct } from "./catalog";
import { subscribeEbayInboundNotifications } from "./notifications-setup";
import {
  appendConditionDescriptorsToInventoryBody,
  fetchConditionDescriptorMetadata,
  fetchItemConditionPolicy,
  isEbayConditionSyncError,
  preserveOrBuildConditionDescriptorsOnBody,
  summarizeConditionDescriptors,
  type EbayInventoryConditionDescriptor,
} from "./conditions";
import { resolveRemappedEbayCategoryId } from "./expired-categories";
import { getItemAspectsForCategory } from "./aspects";
import { formatListingFeeSummary, getListingFeeBlockReason, getListingFees } from "./fees";
import {
  alignVariantRowsToLiveEbayInventory,
  applyLiveEbayVariationSkus,
  buildInventoryItemGroupBody,
  buildInventoryItemGroupKey,
  buildVariantInventoryRows,
  buildVariantSyncItem,
  createOrReplaceInventoryItemGroup,
  liveEbayVariantSkusForGroupPut,
  mergeGeneratedSkusIntoVariants,
  applyInventoryItemGroupPhotoPolicy,
  inventoryItemGroupInwPhotoUrls,
  publishOfferByInventoryItemGroup,
  readInventoryItemGroupImageUrls,
  readInventoryItemGroupVariantSkus,
  readLiveEbayInventorySkusFromVariants,
  resolveLiveEbayInventoryItemGroup,
  shouldPutEbayVariantInventoryOnLiveListing,
  shouldUseInventoryItemGroup,
  withVariationAspect,
  type EbayVariantInventoryRow,
} from "./inventory-groups";
import {
  emptyOfferFulfillmentIndex,
  listEbayOfferFulfillmentPolicies,
  listInventoryItems,
  mergeInventoryRowsWithTrading,
  resolveEbayListingFulfillmentPolicyId,
} from "./inventory-import";
import {
  applyEbayInventoryPhotoPolicy,
  hostedEbayGalleryUrls,
  mergeLiveEbayPhotoUrls,
  omitInventoryProductImageUrls,
  pickHostedEbayGallery,
  putInventoryWithPhotoRecovery,
  readInventoryProductImageUrls,
  readStoredPhotoUrls,
  resolveEbayVariantGroupPhotoPlan,
  ebayPhotosAreHostFamilyMismatchOnly,
} from "./media";
import {
  checkRevisionLimit,
  getRevisionLimitWarning,
  hydrateRevisionCountsFromConfig,
  EBAY_DAILY_REVISION_LIMIT,
  persistRevisionCount,
} from "./rate-limits";
import { resolveProviderCategoryId } from "../category-map";
import {
  buildEbayInventoryItem,
  buildEbayOffer,
  ebayListingToSummary,
  ebayPriceFromCents,
  resolveCategoryId,
  resolveSyncLegacyListingId,
  resolveEbayLegacyListingId,
} from "./mapping";
import {
  enrichSyncItemConditionFromEbay,
  prepareEbaySyncCondition,
} from "./fix-condition";
import {
  formatMissingEbayAspectsError,
  persistEbayAspects,
  persistEbayCategoryId,
  prepareEbaySyncAspects,
} from "./sync-aspects";
import { parseStoredAspects, aspectsToEbayProductAspects } from "@/lib/listing-limits";
import { channelTreatsItemInStock, matrixHasKnownSkuPrices } from "@/lib/listing-variant-matrix";
import { hasOptionQuantities } from "../../store-item-variants";
import {
  enumerateEbayListings,
  fetchEbayItemDetails,
  endEbayTradingItem,
} from "./trading";
import { EBAY_MARKETPLACE_ID } from "./config";
import {
  startTrace,
  addInputSnapshot,
  addValidation,
  addTransform,
  addRequest,
  addResponse,
  completeTrace,
  type SyncTraceContext,
  type ValidationCheck,
} from "../sync-trace";
import { prisma } from "database";
import { isEbayEndedListingError } from "../error-classifier";
import { isEbayListingEnded, persistEbayListingEnded } from "../listing-link-flags";
import {
  ebayExternalIdLooksLive,
  extractEbayInventoryAspects,
  isImportedEbayLink,
  resolveEbayPushSku,
} from "./listing-origin";
import {
  ebayOfferIsPublished,
  pickEbayOffer,
  readEbayOfferListingId,
  shouldDeleteUnpublishedZeroQuantityOffer,
  shouldPublishEbayInventoryGroup,
  shouldRepublishEbayOffer,
  shouldSkipEbayInventoryContentPutAtZeroQty,
  shouldSkipEbayUnpublishedZeroQuantitySync,
  shouldWriteEbayOffer,
  shouldBlockEbayUpdateForMissingAspects,
  shouldFetchTradingItemOnUpsert,
} from "./publish-policy";
import { passthroughUsePreparedInventoryAspects } from "./aspect-prep";
import {
  buildPassthroughInventoryContentPutBody,
  buildPassthroughLiveOverlayBody,
  detectLivePassthroughChanges,
  inwPhotosChangedSinceLastEbayPush,
  shouldPushInwPhotosToEbay,
  fetchLiveInventoryItem,
  formatPassthroughFieldSyncSummary,
  formatPassthroughPutNote,
  needsInventoryPut,
  overlayPassthroughOffer,
  passthroughAllAttemptedFailed,
  passthroughEndedQuantityOnly,
  passthroughShouldPushVariantOffers,
  passthroughSyncHasFailures,
  readOfferPriceCents,
  resolvePassthroughChanges,
  type PassthroughBuildOptions,
  type PassthroughFieldResult,
} from "./passthrough-push";
import { bestOfferStatesMatch, inwBestOfferState, readOfferBestOfferTerms } from "./best-offer";
import { fetchAndCacheEbayInventoryAspects } from "./inventory-aspects-cache";
import { detectStoreItemFieldChanges } from "../sync-baseline";
import { pushEbayAbsoluteQuantity, pushEbayVariantGroupQuantities } from "./quantity";
import type { ListingAspect } from "@/lib/listing-limits";

type EbayOffer = { offerId?: string; status?: string; listing?: { listingId?: string } };
type OfferSearch = { offers?: EbayOffer[] };

/** Keep a 12-SKU group off the serial round-trip path that blew past Vercel 120s. */
const EBAY_VARIANT_IO_CONCURRENCY = 4;

async function mapInChunks<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  const n = Math.max(1, size);
  for (let i = 0; i < items.length; i += n) {
    const slice = items.slice(i, i + n);
    const chunk = await Promise.all(slice.map((item, offset) => fn(item, i + offset)));
    out.push(...chunk);
  }
  return out;
}

/** Find the first offer for a SKU (used to resolve offerId from the stored SKU). */
async function findOffer(accessToken: string, sku: string): Promise<EbayOffer | null> {
  try {
    const res = await ebayGet<OfferSearch>(
      accessToken,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    return pickEbayOffer(res.offers);
  } catch (e) {
    if (e instanceof EbayApiError && (e.status === 404 || isEbayOfferLookupMiss(e))) return null;
    throw e;
  }
}

async function getOfferDetails(
  accessToken: string,
  offerId: string
): Promise<Record<string, unknown> | null> {
  try {
    return await ebayGet<Record<string, unknown>>(
      accessToken,
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`
    );
  } catch (e) {
    if (e instanceof EbayApiError && (e.status === 404 || isEbayOfferLookupMiss(e))) return null;
    throw e;
  }
}

async function persistEbayVariantOptionSkus(
  storeItemId: string,
  variants: unknown,
  rows: EbayVariantInventoryRow[]
): Promise<void> {
  const next = mergeGeneratedSkusIntoVariants(variants, rows);
  if (!next) return;
  try {
    await prisma.storeItem.update({
      where: { id: storeItemId },
      data: { variants: next as object },
    });
  } catch (e) {
    console.warn("[ebay] persist variant option SKUs failed", {
      storeItemId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Live eBay stock is offer.availableQuantity — publish_by_group often leaves each variation at 1. */
async function pushVariantGroupQuantities(
  accessToken: string,
  rows: EbayVariantInventoryRow[],
  offerIdsBySku?: Map<string, string>
): Promise<void> {
  const withOffers: { sku: string; quantity: number; offerId?: string | null }[] = [];
  for (const row of rows) {
    const known = offerIdsBySku?.get(row.sku);
    if (known) {
      withOffers.push({ sku: row.sku, quantity: row.quantity, offerId: known });
      continue;
    }
    try {
      const offer = await findOffer(accessToken, row.sku);
      withOffers.push({ sku: row.sku, quantity: row.quantity, offerId: offer?.offerId ?? null });
    } catch (e) {
      console.warn("[ebay] variant offer lookup for quantity failed", {
        sku: row.sku,
        error: describeEbayThrownError(e),
      });
      withOffers.push({ sku: row.sku, quantity: row.quantity, offerId: null });
    }
  }
  await pushEbayVariantGroupQuantities(accessToken, withOffers);
}

async function publishOffer(accessToken: string, offerId: string): Promise<string | undefined> {
  const res = await ebayAction<{ listingId?: string }>(
    accessToken,
    `/sell/inventory/v1/offer/${offerId}/publish`,
    "POST"
  );
  const listingId = res && typeof res === "object" ? res.listingId : undefined;
  return listingId && /^\d+$/.test(String(listingId).trim()) ? String(listingId).trim() : undefined;
}

const itemConditionPolicyByCategory = new Map<
  string,
  Awaited<ReturnType<typeof fetchItemConditionPolicy>>
>();

async function finalizeInventoryBody(
  accessToken: string,
  body: Record<string, unknown>,
  args: {
    categoryId: string | null;
    pushAspects: ListingAspect[];
    operation: "create" | "update";
    item: SyncStoreItem;
    skipCatalog?: boolean;
  }
): Promise<Record<string, unknown>> {
  const productAspects = aspectsToEbayProductAspects(args.pushAspects);
  if (args.categoryId && args.operation === "create") {
    try {
      let policy = itemConditionPolicyByCategory.get(args.categoryId);
      if (!policy) {
        policy = await fetchItemConditionPolicy(accessToken, args.categoryId);
        itemConditionPolicyByCategory.set(args.categoryId, policy);
      }
      if (!policy.hasConditions) {
        delete body.condition;
      }
      body = appendConditionDescriptorsToInventoryBody(
        body,
        productAspects,
        policy.descriptors,
        args.item.title,
        args.categoryId
      );
    } catch (e) {
      console.warn("[ebay] condition descriptor metadata unavailable", {
        categoryId: args.categoryId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (args.operation === "create" && !args.skipCatalog) {
    body = await enrichInventoryBodyWithCatalogProduct({
      itemTitle: args.item.title,
      categoryId: args.categoryId,
      body,
    });
  }
  return body;
}

async function enrichPassthroughInventoryPutBody(
  accessToken: string,
  body: Record<string, unknown>,
  live: Record<string, unknown>,
  categoryId: string | null,
  title: string,
  tradingAspects?: Record<string, string[]> | null
): Promise<Record<string, unknown>> {
  if (!categoryId?.trim()) return body;
  const product = body.product as Record<string, unknown> | undefined;
  const bodyAspects = (product?.aspects ?? {}) as Record<string, string[]>;
  const liveProduct =
    live.product && typeof live.product === "object"
      ? (live.product as Record<string, unknown>)
      : null;
  const liveAspects = (liveProduct?.aspects ?? {}) as Record<string, string[]>;
  const productAspects = { ...liveAspects, ...bodyAspects };
  if (tradingAspects?.Grade?.length) {
    productAspects.Grade = tradingAspects.Grade;
  }
  if (tradingAspects?.Certification?.length && !productAspects["Professional grader"]?.length) {
    productAspects.Certification = tradingAspects.Certification;
  }
  try {
    const metadata = await fetchConditionDescriptorMetadata(accessToken, categoryId);
    const enriched = preserveOrBuildConditionDescriptorsOnBody(
      body,
      live,
      productAspects,
      metadata,
      title,
      categoryId
    );
    const summary = summarizeConditionDescriptors(
      enriched.conditionDescriptors as EbayInventoryConditionDescriptor[] | undefined,
      metadata
    );
    if (summary.length > 0) {
      console.warn("[ebay] passthrough conditionDescriptors resolved", { categoryId, summary });
      const letter = summary.find((row) => row.name.toLowerCase().includes("letter grade"));
      const numerical = summary.find((row) => row.name.toLowerCase().includes("numerical grade"));
      if (letter && numerical && letter.valueId === numerical.valueId) {
        console.warn("[ebay] passthrough conditionDescriptors duplicate grade valueId", {
          categoryId,
          letter,
          numerical,
        });
      }
    }
    return enriched;
  } catch (e) {
    console.warn("[ebay] passthrough condition descriptor enrichment failed", {
      categoryId,
      error: e instanceof Error ? e.message : String(e),
    });
    return body;
  }
}

/**
 * Create/update the inventory item + offer for a StoreItem and (when policies allow) publish.
 *
 * For INW-created listings the SKU = StoreItem.id. For imported listings the eBay-assigned
 * migrated SKU differs from item.id; callers pass it via `linkedSku` so we target the
 * correct inventory item + offer on eBay rather than creating an orphan.
 */
type UpsertResult = {
  sku: string;
  listingId?: string;
  publishError?: string;
  /** Publish/content succeeded but the post-publish variant quantity write failed. */
  quantityError?: string;
};

async function upsertListing(
  conn: ChannelConnectionContext,
  item: SyncStoreItem,
  linkedSku?: string
): Promise<UpsertResult> {
  const ebayLink = await prisma.channelListingLink.findFirst({
    where: { storeItemId: item.id, provider: "ebay" },
    select: {
      id: true,
      externalListingId: true,
      linkOrigin: true,
      ebayInventoryAspects: true,
      lastPushedHash: true,
      lastPushedPhotos: true,
      conflictDetails: true,
      connection: { select: { memberId: true } },
    },
  });
  const linkExternalId = linkedSku ?? ebayLink?.externalListingId ?? item.id;
  const sku = resolveEbayPushSku({
    itemId: item.id,
    itemSku: item.sku,
    externalListingId: linkExternalId,
    linkOrigin: ebayLink?.linkOrigin,
  });
  let operation: "create" | "update" = ebayExternalIdLooksLive(linkExternalId) ? "update" : "create";
  
  // Start trace for this sync operation
  const trace = startTrace(conn.memberId, "ebay", item.id, operation, {
    sku,
    categoryId: item.ebayCategoryId?.toString() ?? null,
  });

  // Capture input snapshot
  addInputSnapshot(trace, {
    title: item.title,
    priceCents: item.priceCents,
    quantity: item.quantity,
    condition: item.condition,
    ebayConditionEnum: item.ebayConditionEnum,
    ebayCategoryId: item.ebayCategoryId,
    aspects: item.aspects,
    status: item.status,
  });

  try {
    const cfg = readEbayConfig(conn.config);
    hydrateRevisionCountsFromConfig(conn.config);

    // Validation checks
    const validationChecks: ValidationCheck[] = [];

    // Check rate limit before making any changes
    const limitCheck = checkRevisionLimit(sku);
    if (limitCheck.atLimit) {
      const warning = getRevisionLimitWarning(sku);
      validationChecks.push({
        name: "rate_limit",
        passed: false,
        detail: warning || "eBay daily revision limit reached",
        severity: "error",
      });
      addValidation(trace, { valid: false, checks: validationChecks });
      console.error("[ebay] upsertListing: rate limit reached", { sku, count: limitCheck.count });
      await completeTrace(trace, "validation_failed", new Error("Rate limit reached"));
      return { sku, publishError: warning || "eBay daily revision limit reached" };
    }
    if (limitCheck.nearLimit) {
      validationChecks.push({
        name: "rate_limit",
        passed: true,
        detail: `Approaching rate limit: ${limitCheck.count}/${EBAY_DAILY_REVISION_LIMIT}`,
        severity: "warning",
      });
      console.warn("[ebay] upsertListing: approaching rate limit", { sku, count: limitCheck.count });
    } else {
      validationChecks.push({ name: "rate_limit", passed: true, severity: "warning" });
    }

    let targetCategoryId =
      item.ebayCategoryId != null
        ? String(item.ebayCategoryId)
        : resolveCategoryId(
            item,
            (await resolveProviderCategoryId(conn, "ebay", item.category)).ebayCategoryId ?? null
          );
    targetCategoryId = await resolveRemappedEbayCategoryId(targetCategoryId, {
      storeItemId: item.id,
      persist: true,
      currentStoredId: item.ebayCategoryId,
      persistCategoryId: persistEbayCategoryId,
    });

    const existingOffer = await findOffer(conn.accessToken, sku);
    let offerId = existingOffer?.offerId ?? null;
    let existingOfferCategoryId: string | null = null;
    let liveOffer: Record<string, unknown> | null = null;
    if (offerId) {
      liveOffer = await getOfferDetails(conn.accessToken, offerId);
      const rawCategory = liveOffer?.categoryId;
      existingOfferCategoryId = typeof rawCategory === "string" ? rawCategory.trim() : null;
      existingOfferCategoryId = await resolveRemappedEbayCategoryId(existingOfferCategoryId, {
        storeItemId: item.id,
        persist: item.ebayCategoryId == null,
        currentStoredId: item.ebayCategoryId,
        persistCategoryId: persistEbayCategoryId,
      });
    }

    const offerLooksPublished = ebayOfferIsPublished(
      (typeof liveOffer?.status === "string" ? liveOffer.status : null) ?? existingOffer?.status
    );
    const liveListingId =
      resolveEbayLegacyListingId(linkExternalId) ??
      (offerLooksPublished
        ? readEbayOfferListingId(liveOffer) ?? readEbayOfferListingId(existingOffer)
        : null);
    const listingAlreadyLinked = Boolean(liveListingId);
    const hadOfferAtStart = listingAlreadyLinked;
    operation = listingAlreadyLinked ? "update" : "create";

    const isImported = isImportedEbayLink({
      provider: "ebay",
      externalListingId: linkExternalId,
      storeItemId: item.id,
      linkOrigin: ebayLink?.linkOrigin,
    });

    // Imported eBay listings: passthrough push — preserve live inventory aspects verbatim.
    if (isImported) {
      let offerCategoryId = targetCategoryId ?? existingOfferCategoryId;
      offerCategoryId = await resolveRemappedEbayCategoryId(offerCategoryId, {
        storeItemId: item.id,
        persist: true,
        currentStoredId: item.ebayCategoryId,
        persistCategoryId: persistEbayCategoryId,
      });
      validationChecks.push({
        name: "category",
        passed: !!offerCategoryId,
        detail: offerCategoryId ? `Category: ${offerCategoryId}` : "Using live eBay offer category",
        severity: offerCategoryId ? "warning" : "warning",
      });
      validationChecks.push({
        name: "aspects_required",
        passed: true,
        detail: "Passthrough — live eBay aspects preserved",
        severity: "warning",
      });
      addValidation(trace, {
        valid: validationChecks.every((c) => c.passed || c.severity === "warning"),
        checks: validationChecks,
      });

      const live = await fetchLiveInventoryItem(conn.accessToken, sku);
      if (!live) {
        const error = new Error(
          "Could not fetch live eBay inventory item for passthrough sync. Try Refresh from eBay, then sync again."
        );
        await completeTrace(trace, "failed", error);
        throw error;
      }

      const lastPushedPhotos = readStoredPhotoUrls(ebayLink?.lastPushedPhotos);
      const liveChanges = detectLivePassthroughChanges(live, item, liveOffer);
      const inwFields = detectStoreItemFieldChanges(item, ebayLink?.lastPushedHash);
      inwFields.photos =
        inwPhotosChangedSinceLastEbayPush(item.photos, lastPushedPhotos) &&
        !ebayPhotosAreHostFamilyMismatchOnly(
          readInventoryProductImageUrls(live),
          item.photos
        );
      const syncPrefsRow = ebayLink?.connection?.memberId
        ? await prisma.memberSyncPreferences.findUnique({
            where: { memberId: ebayLink.connection.memberId },
            select: {
              syncTitles: true,
              syncDescriptions: true,
              syncPhotos: true,
              syncPrices: true,
            },
          })
        : null;
      const changed = resolvePassthroughChanges(liveChanges, inwFields, {
        syncTitles: syncPrefsRow?.syncTitles ?? true,
        syncDescriptions: syncPrefsRow?.syncDescriptions ?? true,
        syncPhotos: syncPrefsRow?.syncPhotos ?? true,
        syncPrices: syncPrefsRow?.syncPrices ?? true,
      });
      const putInventory = needsInventoryPut(changed);
      const needsInventoryAspectContext = changed.title || putInventory;

      const legacyListingId = await resolveSyncLegacyListingId(conn.accessToken, {
        linkedSku: linkExternalId,
        sku,
        itemSku: item.sku,
        offerId,
      });

      const cachedAspects =
        ebayLink?.ebayInventoryAspects &&
        typeof ebayLink.ebayInventoryAspects === "object" &&
        !Array.isArray(ebayLink.ebayInventoryAspects)
          ? (ebayLink.ebayInventoryAspects as Record<string, string[]>)
          : null;
      const storedAspects = aspectsToEbayProductAspects(parseStoredAspects(item.aspects));

      let tradingAspects: Record<string, string[]> | null = null;
      let tradingPhotoUrls: string[] = [];
      let categoryAspects: Awaited<ReturnType<typeof getItemAspectsForCategory>> = [];
      if (needsInventoryAspectContext) {
        if (legacyListingId) {
          try {
            const details = await fetchEbayItemDetails(conn.accessToken, legacyListingId);
            tradingAspects = aspectsToEbayProductAspects(parseStoredAspects(details.aspects));
            tradingPhotoUrls = details.inventoryPinPhotos ?? [];
          } catch (e) {
            console.warn("[ebay] passthrough GetItem trading aspects failed", {
              storeItemId: item.id,
              legacyListingId,
              error: describeEbayThrownError(e),
            });
          }
        }
        if (offerCategoryId) {
          try {
            categoryAspects = await getItemAspectsForCategory(offerCategoryId, {
              sellerAccessToken: conn.accessToken,
            });
          } catch (e) {
            console.warn("[ebay] passthrough category taxonomy failed", {
              storeItemId: item.id,
              offerCategoryId,
              error: describeEbayThrownError(e),
            });
          }
        }
      }

      const aspectBuildOptions: PassthroughBuildOptions = {
        categoryId: offerCategoryId,
        cachedAspects,
        storedAspects,
        tradingAspects,
        categoryAspects,
      };
      const liveAspects = extractEbayInventoryAspects(live) ?? {};
      const usePreparedAspects = passthroughUsePreparedInventoryAspects(
        liveAspects,
        offerCategoryId,
        tradingAspects,
        item.title
      );

      const fieldResults: PassthroughFieldResult[] = [];
      const passthroughOfferStatus =
        (typeof liveOffer?.status === "string" ? liveOffer.status : null) ??
        existingOffer?.status ??
        null;
      const skipUnpublishedZeroQty = shouldSkipEbayUnpublishedZeroQuantitySync({
        quantity: item.quantity,
        offerStatus: passthroughOfferStatus,
      });

      addTransform(trace, {
        before: { passthrough: true, liveChanges, inwFields, changed },
        after: {
          overlays: [
            changed.quantity ? "bulk_quantity" : null,
            changed.price || changed.description || changed.bestOffer
              ? "offer_price_description_best_offer"
              : null,
            changed.title && putInventory
              ? "inventory_title_and_photos"
              : changed.title
                ? "inventory_title_only"
                : putInventory
                  ? "inventory_photos_only"
                  : null,
          ].filter(Boolean),
        },
        remaps: [],
        dropped: [],
      });

      if (changed.quantity) {
        if (isEbayListingEnded(ebayLink?.conflictDetails) || skipUnpublishedZeroQty) {
          if (skipUnpublishedZeroQty) {
            console.info("[ebay] skip unpublished zero-qty write", {
              storeItemId: item.id,
              sku,
              offerId,
              offerStatus: passthroughOfferStatus,
            });
          }
          fieldResults.push({ field: "quantity", ok: true });
        } else {
          const quantity = Math.max(0, item.quantity);
          const bulkFields: PassthroughFieldResult[] = [{ field: "quantity", ok: false }];
          try {
            await pushEbayAbsoluteQuantity({
              accessToken: conn.accessToken,
              sku,
              quantity,
              offerId,
              title: item.title,
            });
            await persistRevisionCount(conn.id, sku, conn.config);
            bulkFields[0]!.ok = true;
          } catch (e) {
            const msg = describeEbayThrownError(e);
            if (isEbayEndedListingError(e) || isEbayEndedListingError(msg)) {
              bulkFields[0]!.ok = true;
              if (ebayLink) {
                await persistEbayListingEnded(ebayLink.id, ebayLink.conflictDetails);
              }
            } else if (isEbayUnpublishedZeroQuantityError(msg)) {
              console.info("[ebay] skip #25004 zero-qty on unpublished offer", {
                storeItemId: item.id,
                sku,
                offerId,
              });
              bulkFields[0]!.ok = true;
            } else {
              bulkFields[0]!.error = msg;
              if (e instanceof EbayApiError) {
                addResponse(trace, e.status, { error: e.message, body: e.body });
              }
            }
          }
          fieldResults.push(...bulkFields);
        }
      }

      // Multi-variation imported listings have one offer per variant SKU. Compute the rows once
      // so both the content PUT and the per-variant offer price/description update can use them.
      const variantRows = shouldUseInventoryItemGroup(item)
        ? buildVariantInventoryRows(item, {
            parentSku: sku,
            legacyListingId,
            imported: true,
          })
        : [];

      const pushInventoryContent = changed.title === true || putInventory;
      let inventoryContentPutOk = !pushInventoryContent;

      if (
        pushInventoryContent &&
        (shouldSkipEbayInventoryContentPutAtZeroQty(item.quantity) || skipUnpublishedZeroQty)
      ) {
        console.info("[ebay] skip inventory content PUT at quantity 0", {
          storeItemId: item.id,
          sku,
          offerId,
        });
        inventoryContentPutOk = true;
      } else if (pushInventoryContent) {
        const contentOverlays = { title: changed.title === true, photos: putInventory };
        let { body: inventoryBody, aspectMode } = buildPassthroughInventoryContentPutBody(
          live,
          item,
          contentOverlays,
          usePreparedAspects,
          aspectBuildOptions
        );
        inventoryBody = await enrichPassthroughInventoryPutBody(
          conn.accessToken,
          inventoryBody,
          live,
          offerCategoryId,
          item.title,
          tradingAspects
        );
        const putNote = formatPassthroughPutNote(inventoryBody);
        console.warn("[ebay] upsertListing passthrough PUT inventory content", {
          storeItemId: item.id,
          sku,
          linkExternalId,
          changed,
          contentOverlays,
          aspectMode,
          conditionDescriptorCount: Array.isArray(inventoryBody.conditionDescriptors)
            ? inventoryBody.conditionDescriptors.length
            : 0,
          conditionDescriptors: inventoryBody.conditionDescriptors ?? null,
          aspectKeys: Object.keys(
            ((inventoryBody.product as Record<string, unknown> | undefined)?.aspects ?? {}) as Record<
              string,
              string[]
            >
          ),
          titleLength: changed.title ? item.title.length : undefined,
          usePreparedAspects,
          legacyListingId: legacyListingId ?? null,
        });
        addRequest(trace, inventoryBody);
        const putPassthroughInventory = async (
          payload: Record<string, unknown>,
          targetSku = sku
        ) => {
          await putInventoryWithPhotoRecovery({
            accessToken: conn.accessToken,
            body: payload,
            liveImageUrls: mergeLiveEbayPhotoUrls(readInventoryProductImageUrls(live), tradingPhotoUrls),
            fallbackImageUrls: [],
            allowInwPhotoUpload: false,
            describeError: describeEbayThrownError,
            put: async (next) => {
              await ebayJson(
                conn.accessToken,
                `/sell/inventory/v1/inventory_item/${encodeURIComponent(targetSku)}`,
                "PUT",
                next
              );
              await persistRevisionCount(conn.id, targetSku, conn.config);
            },
          });
        };
        const putPassthroughInventoryTargets = async (payload: Record<string, unknown>) => {
          if (variantRows.length === 0) {
            await putPassthroughInventory(payload);
            return;
          }
          for (const row of variantRows) {
            await putPassthroughInventory(withVariationAspect(payload, row), row.sku);
          }
        };
        let contentPutOk = false;
        try {
          await putPassthroughInventoryTargets(inventoryBody);
          addResponse(trace, 200, {
            success: true,
            contentOverlays,
            aspectMode,
            warnings: takeEbayCallWarnings().map((w) => w.longMessage || w.message),
          });
          contentPutOk = true;
        } catch (e) {
          if (!usePreparedAspects && isEbayInventoryAspectValidationError(e)) {
            const retry = buildPassthroughInventoryContentPutBody(
              live,
              item,
              contentOverlays,
              true,
              aspectBuildOptions
            );
            aspectMode = retry.aspectMode;
            inventoryBody = retry.body;
            inventoryBody = await enrichPassthroughInventoryPutBody(
              conn.accessToken,
              inventoryBody,
              live,
              offerCategoryId,
              item.title,
              tradingAspects
            );
            console.warn("[ebay] passthrough PUT inventory content retry with prepared aspects", {
              storeItemId: item.id,
              sku,
              contentOverlays,
              aspectMode,
            });
            try {
              await putPassthroughInventoryTargets(inventoryBody);
              addResponse(trace, 200, {
                success: true,
                contentOverlays,
                aspectMode,
                warnings: takeEbayCallWarnings().map((w) => w.longMessage || w.message),
              });
              contentPutOk = true;
            } catch (retryErr) {
              e = retryErr;
            }
          }
          if (!contentPutOk) {
            const msg = `${describeEbayThrownError(e)}. ${putNote}`;
            if (isEbayUnpublishedZeroQuantityError(msg)) {
              console.info("[ebay] skip inventory content PUT after #25004", {
                storeItemId: item.id,
                sku,
              });
              contentPutOk = true;
            } else {
              const contentAspects = (
                (inventoryBody.product as Record<string, unknown> | undefined)?.aspects ?? {}
              ) as Record<string, string[]>;
              console.error("[ebay] passthrough PUT inventory content failed — full eBay error", {
                storeItemId: item.id,
                sku,
                offerCategoryId,
                contentOverlays,
                aspectKeys: Object.keys(contentAspects),
                aspectValues: contentAspects,
                aspectMode,
                usePreparedAspects,
                ...formatEbayErrorDiagnostics(e),
              });
              if (e instanceof EbayApiError) {
                addResponse(trace, e.status, { error: e.message, body: e.body });
              }
              if (changed.title) {
                fieldResults.push({ field: "title", ok: false, error: msg });
              }
              if (putInventory) {
                fieldResults.push({ field: "photos", ok: false, error: msg });
              }
            }
          }
        }
        if (contentPutOk) {
          if (changed.title) fieldResults.push({ field: "title", ok: true });
          if (putInventory) fieldResults.push({ field: "photos", ok: true });
        }
        inventoryContentPutOk = contentPutOk;
      }

      const pushVariantOffers = passthroughShouldPushVariantOffers({
        changed,
        hasVariantRows: variantRows.length > 0,
        hasSkuPrices: matrixHasKnownSkuPrices(item.variants),
      });
      if (pushVariantOffers && inventoryContentPutOk) {
        if (variantRows.length > 0) {
          // Imported multi-variation listing: price/description/bestOffer live on EACH variant's
          // own offer, not a single parent offer. Push the per-SKU price to every variant offer
          // so varying prices actually reach eBay (they were previously dropped here).
          let anyOfferPutFailed = false;
          let attemptedAny = false;
          let priceMismatch = false;
          const overlayPrice = changed.price || matrixHasKnownSkuPrices(item.variants);
          for (const row of variantRows) {
            const variantItem = buildVariantSyncItem(item, row);
            const vOffer = await findOffer(conn.accessToken, row.sku).catch(() => null);
            if (!vOffer?.offerId) {
              anyOfferPutFailed = true;
              continue;
            }
            attemptedAny = true;
            const vOfferDetails =
              (await getOfferDetails(conn.accessToken, vOffer.offerId).catch(() => null)) ??
              (vOffer as unknown as Record<string, unknown>);
            const vOfferBody = overlayPassthroughOffer(vOfferDetails, variantItem, {
              ...changed,
              quantity: false,
              title: false,
              photos: false,
              price: overlayPrice,
            });
            try {
              await ebayJson(
                conn.accessToken,
                `/sell/inventory/v1/offer/${vOffer.offerId}`,
                "PUT",
                vOfferBody
              );
              await persistRevisionCount(conn.id, row.sku, conn.config);
              if (overlayPrice) {
                const refreshed = await getOfferDetails(conn.accessToken, vOffer.offerId).catch(
                  () => null
                );
                const applied = readOfferPriceCents(refreshed);
                if (applied != null && applied !== variantItem.priceCents) priceMismatch = true;
              }
            } catch (e) {
              anyOfferPutFailed = true;
              console.warn("[ebay] passthrough variant offer update failed", {
                sku: row.sku,
                error: describeEbayThrownError(e),
              });
            }
          }
          const offersOk = attemptedAny && !anyOfferPutFailed;
          const priceOk = offersOk && !priceMismatch;
          const failMsg = !attemptedAny
            ? "No eBay variation offers found to update."
            : anyOfferPutFailed
              ? "One or more eBay variation offers failed to update."
              : priceMismatch
                ? "One or more eBay variation prices didn't update."
                : undefined;
          if (overlayPrice) {
            fieldResults.push({ field: "price", ok: priceOk, error: priceOk ? undefined : failMsg });
          }
          if (changed.description) {
            fieldResults.push({
              field: "description",
              ok: offersOk,
              error: offersOk ? undefined : failMsg,
            });
          }
          if (changed.bestOffer) {
            fieldResults.push({
              field: "bestOffer",
              ok: offersOk,
              error: offersOk ? undefined : failMsg,
            });
          }
          console.log("[ebay] passthrough per-variation offer prices pushed", {
            storeItemId: item.id,
            sku,
            variantCount: variantRows.length,
            attemptedAny,
            anyOfferPutFailed,
            priceMismatch,
          });
        } else {
        if (!offerId) {
          const recovered = await findOffer(conn.accessToken, sku);
          offerId = recovered?.offerId ?? null;
          if (offerId && !liveOffer) {
            liveOffer = await getOfferDetails(conn.accessToken, offerId);
          }
        }
        if (!offerId || !liveOffer) {
          const missingOfferError =
            "Could not update eBay offer — no published offer found for this imported listing.";
          if (changed.price) {
            fieldResults.push({ field: "price", ok: false, error: missingOfferError });
          }
          if (changed.description) {
            fieldResults.push({ field: "description", ok: false, error: missingOfferError });
          }
          if (changed.bestOffer) {
            fieldResults.push({ field: "bestOffer", ok: false, error: missingOfferError });
          }
        } else {
          const offerBody = overlayPassthroughOffer(liveOffer, item, {
            ...changed,
            quantity: false,
            title: false,
            photos: false,
          });
          const offerFields: PassthroughFieldResult[] = [];
          if (changed.price) offerFields.push({ field: "price", ok: false });
          if (changed.description) offerFields.push({ field: "description", ok: false });
          if (changed.bestOffer) offerFields.push({ field: "bestOffer", ok: false });
          try {
            await ebayJson(
              conn.accessToken,
              `/sell/inventory/v1/offer/${offerId}`,
              "PUT",
              offerBody
            );
            await persistRevisionCount(conn.id, sku, conn.config);
            const refreshed = await getOfferDetails(conn.accessToken, offerId);
            const wantedBest = inwBestOfferState(item);
            for (const row of offerFields) {
              if (row.field === "price") {
                const applied = readOfferPriceCents(refreshed);
                if (applied != null && applied !== item.priceCents) {
                  row.error = `Price didn't update on eBay (offer still $${(applied / 100).toFixed(2)}).`;
                } else {
                  row.ok = true;
                }
              } else if (row.field === "bestOffer") {
                const appliedBest = readOfferBestOfferTerms(refreshed);
                if (!bestOfferStatesMatch(appliedBest, wantedBest)) {
                  console.warn("[ebay] passthrough bestOffer verification mismatch", {
                    wanted: wantedBest,
                    applied: appliedBest,
                  });
                  row.error = "Best Offer settings didn't update on eBay.";
                } else {
                  row.ok = true;
                }
              } else {
                row.ok = true;
              }
            }
          } catch (e) {
            const msg = describeEbayThrownError(e);
            for (const row of offerFields) {
              row.error = `eBay offer update failed: ${msg}`;
            }
            if (e instanceof EbayApiError) {
              addResponse(trace, e.status, { error: e.message, body: e.body });
            }
          }
          fieldResults.push(...offerFields);
        }
        }
      } else if (pushVariantOffers && !inventoryContentPutOk) {
        const blockedError = "Skipped eBay offer update because inventory content update failed.";
        if (changed.price || matrixHasKnownSkuPrices(item.variants)) {
          fieldResults.push({ field: "price", ok: false, error: blockedError });
        }
        if (changed.description) {
          fieldResults.push({ field: "description", ok: false, error: blockedError });
        }
        if (changed.bestOffer) fieldResults.push({ field: "bestOffer", ok: false, error: blockedError });
      }

      if (ebayLink && putInventory && fieldResults.some((r) => r.field === "photos" && r.ok)) {
        await fetchAndCacheEbayInventoryAspects(conn.accessToken, ebayLink.id, sku);
      }

      console.warn("[ebay] upsertListing passthrough", {
        storeItemId: item.id,
        sku,
        linkExternalId,
        linkOrigin: ebayLink?.linkOrigin ?? null,
        changed,
        putInventory,
        fieldResults,
      });

      if (passthroughSyncHasFailures(fieldResults)) {
        if (passthroughEndedQuantityOnly(fieldResults) && ebayLink) {
          await persistEbayListingEnded(ebayLink.id, ebayLink.conflictDetails);
          await completeTrace(trace, "success");
          return { sku };
        }
        const summary = formatPassthroughFieldSyncSummary(fieldResults);
        const error = new Error(
          passthroughAllAttemptedFailed(fieldResults)
            ? summary
            : `eBay passthrough partial sync: ${summary}`
        );
        await completeTrace(trace, "failed", error);
        throw error;
      }

      await completeTrace(trace, "success");
      return { sku };
    }

    // Validate category
    validationChecks.push({
      name: "category",
      passed: !!targetCategoryId,
      detail: targetCategoryId ? `Category: ${targetCategoryId}` : "No eBay category set",
      severity: targetCategoryId ? "warning" : "error",
    });

    let workingItem = await enrichSyncItemConditionFromEbay(conn.accessToken, linkedSku ?? sku, item);

    // eBay validates inventory condition against the offer's primary category — use target if set, else live offer cat.
    const conditionCategoryId = targetCategoryId ?? existingOfferCategoryId;

    const legacyListingId = await resolveSyncLegacyListingId(conn.accessToken, {
      linkedSku,
      sku,
      itemSku: item.sku,
      offerId,
    });

    let liveTradingAspects: ReturnType<typeof parseStoredAspects> = [];
    let liveTradingPhotoUrls: string[] = [];
    let liveTradingVariants: unknown = null;
    let liveCategoryId: string | null = null;
    const fetchTradingDetails = shouldFetchTradingItemOnUpsert({
      listingAlreadyLinked,
      usesInventoryItemGroup: shouldUseInventoryItemGroup(item),
    });
    if (legacyListingId && fetchTradingDetails) {
      try {
        const liveDetails = await fetchEbayItemDetails(conn.accessToken, legacyListingId);
        liveTradingAspects = liveDetails.aspects;
        liveTradingPhotoUrls = liveDetails.inventoryPinPhotos ?? [];
        liveTradingVariants = liveDetails.variants ?? null;
        liveCategoryId = liveDetails.remoteCategoryId;
      } catch (e) {
        console.warn("[ebay] upsertListing live GetItem enrichment failed", {
          storeItemId: item.id,
          legacyListingId,
          error: describeEbayThrownError(e),
        });
      }
    }

    const aspectCategoryId =
      item.ebayCategoryId != null
        ? String(item.ebayCategoryId)
        : liveCategoryId ?? targetCategoryId ?? existingOfferCategoryId;

    if (!aspectCategoryId) {
      validationChecks.push({
        name: "ebay_category",
        passed: false,
        detail: "No eBay category on listing or live offer",
        severity: "error",
      });
      addValidation(trace, { valid: false, checks: validationChecks });
      const error = new Error(
        "This listing has no eBay category. Select a category under eBay Listing Requirements, save, then sync again."
      );
      await completeTrace(trace, "validation_failed", error);
      throw error;
    }

    let prepared = await prepareEbaySyncCondition({
      accessToken: conn.accessToken,
      storeItemId: item.id,
      item: workingItem,
      categoryId: conditionCategoryId,
    });
    let syncItem = prepared.item;

    if (item.ebayCategoryId == null && liveCategoryId) {
      const parsedCategory = Number(liveCategoryId);
      if (Number.isFinite(parsedCategory) && parsedCategory > 0) {
        syncItem = { ...syncItem, ebayCategoryId: parsedCategory };
        await persistEbayCategoryId(item.id, parsedCategory);
      }
    }

    // Validate condition
    validationChecks.push({
      name: "condition",
      passed: !!prepared.conditionEnum,
      detail: prepared.conditionEnum
        ? `Condition: ${prepared.conditionEnum}${prepared.autoCorrected ? " (auto-corrected)" : ""}`
        : "No condition set",
      severity: "error",
    });

    const aspectPrep = await prepareEbaySyncAspects({
      accessToken: conn.accessToken,
      externalListingId: linkedSku ?? sku,
      item: syncItem,
      categoryId: aspectCategoryId,
      sku,
      offerId,
      tradingAspects: liveTradingAspects,
      enforceListOnRequirements: !listingAlreadyLinked,
    });
    syncItem = aspectPrep.item;
    const pushAspects = parseStoredAspects(syncItem.aspects);

    // Capture transform trace for aspects
    const inputAspects = parseStoredAspects(item.aspects);
    const outputAspects = parseStoredAspects(syncItem.aspects);
    addTransform(trace, {
      before: { aspects: inputAspects },
      after: { aspects: outputAspects },
      remaps: aspectPrep.remaps ?? [],
      dropped: aspectPrep.dropped ?? [],
      categorySchema: aspectPrep.categorySchema?.map((a) => ({
        name: a.name,
        required: a.required,
      })),
    });

    // Validate aspects — list-on only. Live listings already passed eBay's checks.
    if (
      aspectPrep.missingRequired.length > 0 &&
      shouldBlockEbayUpdateForMissingAspects(listingAlreadyLinked)
    ) {
      const missingNames = aspectPrep.missingRequired.map((a) => 
        typeof a === "string" ? a : a.name
      );
      validationChecks.push({
        name: "aspects_required",
        passed: false,
        detail: `Missing required: ${missingNames.join(", ")}`,
        severity: "error",
      });
      addValidation(trace, { valid: false, checks: validationChecks });
      const error = new Error(formatMissingEbayAspectsError(aspectPrep.missingRequired));
      await completeTrace(trace, "validation_failed", error);
      throw error;
    }
    if (listingAlreadyLinked && aspectPrep.missingRequired.length > 0) {
      console.warn("[ebay] upsertListing continuing live update despite missing aspects", {
        storeItemId: item.id,
        sku,
        missing: aspectPrep.missingRequired.map((a) => (typeof a === "string" ? a : a.name)),
      });
    }

    if (aspectPrep.enriched) {
      await persistEbayAspects(item.id, parseStoredAspects(syncItem.aspects));
    }

    validationChecks.push({
      name: "aspects_required",
      passed: true,
      detail: `${outputAspects.length} aspects set`,
      severity: "warning",
    });

    // Validate policies
    validationChecks.push({
      name: "fulfillment_policy",
      passed: !!cfg.fulfillmentPolicyId,
      detail: cfg.fulfillmentPolicyId ? "Fulfillment policy set" : "No fulfillment policy",
      severity: "error",
    });
    validationChecks.push({
      name: "payment_policy",
      passed: !!cfg.paymentPolicyId,
      detail: cfg.paymentPolicyId ? "Payment policy set" : "No payment policy",
      severity: "error",
    });
    validationChecks.push({
      name: "return_policy",
      passed: !!cfg.returnPolicyId,
      detail: cfg.returnPolicyId ? "Return policy set" : "No return policy",
      severity: "error",
    });

    const allValid = validationChecks.every((c) => c.passed || c.severity === "warning");
    addValidation(trace, { valid: allValid, checks: validationChecks });

    (prepared.autoCorrected ? console.warn : console.info)("[ebay] upsertListing condition", {
      storeItemId: item.id,
      sku,
      targetCategoryId,
      existingOfferCategoryId,
      conditionCategoryId,
      syncConditionEnum: prepared.conditionEnum,
      autoCorrected: prepared.autoCorrected,
      enrichedFromEbay: workingItem.ebayConditionEnum !== item.ebayConditionEnum,
      hasExistingOffer: !!offerId,
      listingAlreadyLinked,
      aspectsEnriched: aspectPrep.enriched,
      aspectCount: parseStoredAspects(syncItem.aspects).length,
    });

    async function pushOfferBody(body: Record<string, unknown>) {
      if (offerId) {
        await ebayJson(conn.accessToken, `/sell/inventory/v1/offer/${offerId}`, "PUT", body);
        await persistRevisionCount(conn.id, sku, conn.config);
        return;
      }
      const created = await ebayJson<{ offerId?: string }>(
        conn.accessToken,
        `/sell/inventory/v1/offer`,
        "POST",
        body
      );
      offerId = created.offerId ?? null;
    }

    const liveNative = await fetchLiveInventoryItem(conn.accessToken, sku);
    const liveNativeImageUrls = mergeLiveEbayPhotoUrls(
      liveNative ? readInventoryProductImageUrls(liveNative) : [],
      liveTradingPhotoUrls
    );
    const lastPushedPhotos = readStoredPhotoUrls(ebayLink?.lastPushedPhotos);
    const listingAlreadyOnEbay =
      listingAlreadyLinked || Boolean(resolveEbayLegacyListingId(linkExternalId));
    const pushInwPhotos = shouldPushInwPhotosToEbay({
      inwPhotos: item.photos,
      lastPushedPhotos,
      listingAlreadyOnEbay,
      unpublishedOfferExists: Boolean(offerId),
      liveGalleryCount: liveNativeImageUrls.length,
    });

    async function pushInventoryBody(body: Record<string, unknown>, traceCtx?: SyncTraceContext) {
      if (traceCtx) {
        addRequest(traceCtx, body);
      }
      try {
        await putInventoryWithPhotoRecovery({
          accessToken: conn.accessToken,
          body,
          fallbackImageUrls: pushInwPhotos ? item.photos : [],
          liveImageUrls: liveNativeImageUrls,
          allowInwPhotoUpload: pushInwPhotos,
          describeError: describeEbayThrownError,
          put: async (payload) => {
            await ebayJson(
              conn.accessToken,
              `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
              "PUT",
              payload
            );
            if (traceCtx) {
              addResponse(traceCtx, 200, { success: true, warnings: takeEbayCallWarnings() });
            }
            await persistRevisionCount(conn.id, sku, conn.config);
          },
        });
      } catch (e) {
        if (traceCtx && e instanceof EbayApiError) {
          addResponse(traceCtx, e.status, { error: e.message, body: e.body });
        }
        throw e;
      }
    }

    let inventoryBody = await finalizeInventoryBody(
      conn.accessToken,
      buildEbayInventoryItem(syncItem, pushAspects),
      {
        categoryId: aspectCategoryId,
        pushAspects,
        operation,
        item: syncItem,
      }
    );
    inventoryBody = applyEbayInventoryPhotoPolicy(inventoryBody, {
      liveImageUrls: liveNativeImageUrls,
      inwPhotos: item.photos,
      pushInwPhotos,
    });
    const offerBody = buildEbayOffer(syncItem, cfg, aspectCategoryId, sku);
    const offerStatus =
      (typeof liveOffer?.status === "string" ? liveOffer.status : null) ??
      existingOffer?.status ??
      null;
    if (
      shouldDeleteUnpublishedZeroQuantityOffer({
        quantity: item.quantity,
        offerId,
        offerStatus,
      }) &&
      offerId
    ) {
      let clearedUnpublishedOffer = false;
      try {
        await ebayAction(conn.accessToken, `/sell/inventory/v1/offer/${offerId}`, "DELETE");
        clearedUnpublishedOffer = true;
        console.info("[ebay] deleted unpublished zero-qty offer so inventory can update", {
          storeItemId: item.id,
          sku,
          offerId,
        });
      } catch (e) {
        if (e instanceof EbayApiError && e.status === 404) {
          clearedUnpublishedOffer = true;
        } else {
          console.warn("[ebay] delete unpublished zero-qty offer failed", {
            storeItemId: item.id,
            sku,
            offerId,
            error: describeEbayThrownError(e),
          });
          try {
            await pushOfferBody({ ...offerBody, availableQuantity: 1 });
          } catch (fallbackErr) {
            console.warn("[ebay] unpublished offer qty-1 fallback failed", {
              storeItemId: item.id,
              sku,
              offerId,
              error: describeEbayThrownError(fallbackErr),
            });
          }
        }
      }
      if (clearedUnpublishedOffer) offerId = null;
    }
    const writeOffer = shouldWriteEbayOffer({
      quantity: item.quantity,
      offerId,
      offerStatus: offerId ? offerStatus : null,
    });

    if (shouldUseInventoryItemGroup(syncItem)) {
      let variantRows = applyLiveEbayVariationSkus(
        buildVariantInventoryRows(syncItem, {
          parentSku: sku,
          legacyListingId,
          imported: isImported,
        }),
        liveTradingVariants
      );
      const liveGroup = await resolveLiveEbayInventoryItemGroup(conn.accessToken, syncItem, sku);
      const liveGroupSkus = readInventoryItemGroupVariantSkus(liveGroup.body);
      variantRows = await alignVariantRowsToLiveEbayInventory(
        conn.accessToken,
        variantRows,
        liveGroupSkus
      );
      const liveKnownSkus =
        liveGroupSkus.length > 0
          ? liveGroupSkus
          : readLiveEbayInventorySkusFromVariants(liveTradingVariants);
      const variantSkus = liveEbayVariantSkusForGroupPut({
        listingAlreadyOnEbay,
        liveGroupSkus,
        mappedSkus: variantRows.map((row) => row.sku),
      });
      const liveBySku = new Map<
        string,
        { live: Record<string, unknown> | null; urls: string[]; offer: EbayOffer | null }
      >();
      let unpublishedVariantOffer = false;
      const variantHostedSources: string[][] = [];
      const offerIdsBySku = new Map<string, string>();
      const scanned = await mapInChunks(variantRows, EBAY_VARIANT_IO_CONCURRENCY, async (row) => {
        const liveVariant = await fetchLiveInventoryItem(conn.accessToken, row.sku);
        const liveUrls = mergeLiveEbayPhotoUrls(
          liveVariant ? readInventoryProductImageUrls(liveVariant) : [],
          liveTradingPhotoUrls
        );
        const variantOffer = await findOffer(conn.accessToken, row.sku);
        return { sku: row.sku, liveVariant, liveUrls, variantOffer };
      });
      for (const rowScan of scanned) {
        if (rowScan.variantOffer?.offerId) {
          unpublishedVariantOffer = true;
          offerIdsBySku.set(rowScan.sku, rowScan.variantOffer.offerId);
        }
        liveBySku.set(rowScan.sku, {
          live: rowScan.liveVariant,
          urls: rowScan.liveUrls,
          offer: rowScan.variantOffer,
        });
        variantHostedSources.push(rowScan.liveUrls);
      }
      const photoPlan = resolveEbayVariantGroupPhotoPlan({
        listingAlreadyOnEbay,
        unpublishedOfferExists: Boolean(offerId) || unpublishedVariantOffer,
        hostedLiveUrls: pickHostedEbayGallery([
          liveNativeImageUrls,
          readInventoryItemGroupImageUrls(liveGroup.body),
          ...variantHostedSources,
        ]),
        inwPhotos: inventoryItemGroupInwPhotoUrls(syncItem),
      });
      let sendInwPhotos = photoPlan.sendInwPhotos;
      let liveVariantImageUrls = photoPlan.pinUrls;
      let photosCommitted =
        !sendInwPhotos && hostedEbayGalleryUrls(liveVariantImageUrls).length > 0;
      let anyVariantHadOffer = false;
      let publishedVariantListingId: string | null = null;

      const writeVariantRow = async (
        row: EbayVariantInventoryRow,
        opts: { omitPhotos: boolean; sendInwPhotos: boolean; refreshGallery: boolean; skipCatalog: boolean }
      ) => {
        const variantItem = buildVariantSyncItem(syncItem, row);
        const cached = liveBySku.get(row.sku);
        const liveUrls = cached?.urls ?? [];
        const hostedLive = hostedEbayGalleryUrls(liveUrls);
        if (hostedLive.length > 0) {
          liveVariantImageUrls = hostedLive;
          sendInwPhotos = false;
        }
        const variantLiveUrls = hostedLive.length > 0 ? hostedLive : liveVariantImageUrls;
        const omitPhotos = opts.omitPhotos && hostedLive.length === 0;
        const putLiveVariant = shouldPutEbayVariantInventoryOnLiveListing({
          listingAlreadyOnEbay,
          sku: row.sku,
          liveKnownSkus,
          pinnedPhotoCount: variantLiveUrls.length,
        });
        if (!putLiveVariant) {
          console.info("[ebay] skip variant inventory put on live listing", {
            storeItemId: item.id,
            sku: row.sku,
            listingAlreadyOnEbay,
            liveKnown: liveKnownSkus.includes(row.sku),
            pinnedPhotoCount: variantLiveUrls.length,
          });
        } else {
          let variantBody = withVariationAspect(
            await finalizeInventoryBody(
              conn.accessToken,
              buildEbayInventoryItem(variantItem, pushAspects),
              {
                categoryId: aspectCategoryId,
                pushAspects,
                operation,
                item: syncItem,
                skipCatalog: opts.skipCatalog,
              }
            ),
            row
          );
          variantBody = omitPhotos
            ? omitInventoryProductImageUrls(variantBody)
            : applyEbayInventoryPhotoPolicy(variantBody, {
                liveImageUrls: variantLiveUrls,
                inwPhotos: inventoryItemGroupInwPhotoUrls(syncItem),
                pushInwPhotos: opts.sendInwPhotos,
              });
          console.info("[ebay] variant inventory photos", {
            storeItemId: item.id,
            sku: row.sku,
            sendInwPhotos: omitPhotos ? false : opts.sendInwPhotos,
            omitPhotos,
            liveCount: variantLiveUrls.length,
            hostedCount: hostedEbayGalleryUrls(variantLiveUrls).length,
            sample: variantLiveUrls[0] ?? readInventoryProductImageUrls(variantBody)[0] ?? null,
          });
          await putInventoryWithPhotoRecovery({
            accessToken: conn.accessToken,
            body: variantBody,
            liveImageUrls: omitPhotos ? [] : variantLiveUrls,
            fallbackImageUrls: omitPhotos || !opts.sendInwPhotos ? [] : inventoryItemGroupInwPhotoUrls(syncItem),
            allowInwPhotoUpload: omitPhotos ? false : opts.sendInwPhotos,
            describeError: describeEbayThrownError,
            put: async (next) => {
              await ebayJson(
                conn.accessToken,
                `/sell/inventory/v1/inventory_item/${encodeURIComponent(row.sku)}`,
                "PUT",
                next
              );
              await persistRevisionCount(conn.id, row.sku, conn.config);
            },
          });
          if (opts.refreshGallery) {
            const refreshed = await fetchLiveInventoryItem(conn.accessToken, row.sku);
            const refreshedUrls = mergeLiveEbayPhotoUrls(
              refreshed ? readInventoryProductImageUrls(refreshed) : [],
              liveTradingPhotoUrls
            );
            const putUrls = readInventoryProductImageUrls(variantBody);
            if (hostedEbayGalleryUrls(refreshedUrls).length > 0) {
              liveVariantImageUrls = hostedEbayGalleryUrls(refreshedUrls);
            } else if (putUrls.length > 0) {
              liveVariantImageUrls = putUrls;
            }
            if (liveVariantImageUrls.length > 0) {
              photosCommitted = true;
              sendInwPhotos = false;
            }
          }
        }
        const variantOffer = cached?.offer ?? (await findOffer(conn.accessToken, row.sku));
        const variantListingId = readEbayOfferListingId(variantOffer);
        if (variantOffer?.offerId && ebayOfferIsPublished(variantOffer.status)) {
          anyVariantHadOffer = true;
          if (variantListingId) publishedVariantListingId ??= variantListingId;
        }
        const variantOfferBody = buildEbayOffer(
          variantItem,
          cfg,
          aspectCategoryId,
          row.sku
        );
        const variantOfferStatus =
          typeof variantOffer?.status === "string" ? variantOffer.status : null;
        if (
          shouldDeleteUnpublishedZeroQuantityOffer({
            quantity: variantItem.quantity,
            offerId: variantOffer?.offerId,
            offerStatus: variantOfferStatus,
          }) &&
          variantOffer?.offerId
        ) {
          try {
            await ebayAction(
              conn.accessToken,
              `/sell/inventory/v1/offer/${variantOffer.offerId}`,
              "DELETE"
            );
          } catch (e) {
            if (!(e instanceof EbayApiError && e.status === 404)) {
              console.warn("[ebay] delete unpublished zero-qty variant offer failed", {
                sku: row.sku,
                offerId: variantOffer.offerId,
                error: describeEbayThrownError(e),
              });
            }
          }
        } else if (
          shouldWriteEbayOffer({
            quantity: variantItem.quantity,
            offerId: variantOffer?.offerId,
            offerStatus: variantOfferStatus,
          })
        ) {
          if (variantOffer?.offerId) {
            await ebayJson(
              conn.accessToken,
              `/sell/inventory/v1/offer/${variantOffer.offerId}`,
              "PUT",
              variantOfferBody
            );
            offerIdsBySku.set(row.sku, variantOffer.offerId);
          } else if (!listingAlreadyOnEbay) {
            const created = await ebayJson<{ offerId?: string }>(
              conn.accessToken,
              `/sell/inventory/v1/offer`,
              "POST",
              variantOfferBody
            );
            if (created.offerId) offerIdsBySku.set(row.sku, created.offerId);
          } else {
            console.info("[ebay] skip creating variant offer on live listing", {
              storeItemId: item.id,
              sku: row.sku,
              linkedListingId: resolveEbayLegacyListingId(linkExternalId),
            });
          }
        }
      };

      const [firstRow, ...otherRows] = variantRows;
      if (firstRow) {
        const firstHosted = hostedEbayGalleryUrls(liveBySku.get(firstRow.sku)?.urls ?? []);
        await writeVariantRow(firstRow, {
          omitPhotos: photosCommitted && firstHosted.length === 0,
          sendInwPhotos,
          refreshGallery: !photosCommitted,
          skipCatalog: false,
        });
      }
      if (otherRows.length > 0) {
        await mapInChunks(otherRows, EBAY_VARIANT_IO_CONCURRENCY, async (row) => {
          await writeVariantRow(row, {
            omitPhotos: photosCommitted,
            sendInwPhotos: false,
            refreshGallery: false,
            skipCatalog: true,
          });
        });
      }
      let groupKey = liveGroup.key || buildInventoryItemGroupKey(syncItem);
      const groupPhotoUrls = mergeLiveEbayPhotoUrls(
        hostedEbayGalleryUrls(liveVariantImageUrls).length > 0
          ? liveVariantImageUrls
          : readInventoryItemGroupImageUrls(liveGroup.body).length > 0
            ? readInventoryItemGroupImageUrls(liveGroup.body)
            : liveVariantImageUrls,
        liveTradingPhotoUrls
      );
      if (listingAlreadyOnEbay && groupPhotoUrls.length === 0) {
        console.info("[ebay] skip inventory group replace; no live photos to pin", {
          storeItemId: item.id,
          sku,
          groupKey,
        });
      } else {
        console.info("[ebay] inventory group photos", {
          storeItemId: item.id,
          groupKey,
          sendInwPhotos,
          liveCount: groupPhotoUrls.length,
          hostedCount: hostedEbayGalleryUrls(groupPhotoUrls).length,
          sample: groupPhotoUrls[0] ?? null,
        });
        const writtenKey = await createOrReplaceInventoryItemGroup(
          conn.accessToken,
          applyInventoryItemGroupPhotoPolicy(
            buildInventoryItemGroupBody(syncItem, variantSkus, pushAspects, groupKey),
            groupPhotoUrls,
            inventoryItemGroupInwPhotoUrls(syncItem),
            sendInwPhotos
          )
        );
        if (writtenKey !== groupKey) {
          console.info("[ebay] adopted existing inventory item group", {
            storeItemId: item.id,
            from: groupKey,
            to: writtenKey,
          });
        }
        groupKey = writtenKey;
      }
      const shouldPublishGroup = shouldPublishEbayInventoryGroup({
        operation,
        canPublish: cfg.canPublish,
        itemIsActive: item.status === "active",
        inStock: channelTreatsItemInStock(item),
        hadOfferAtStart: hadOfferAtStart || anyVariantHadOffer,
        listingAlreadyLinked: listingAlreadyOnEbay,
      });
      if (shouldPublishGroup) {
        if (!hadOfferAtStart) {
          try {
            const feeOfferIds = [...offerIdsBySku.values()];
            const fees = await getListingFees(conn.accessToken, feeOfferIds);
            const blockReason = getListingFeeBlockReason(fees);
            if (blockReason) {
              await completeTrace(trace, "failed", new Error(blockReason));
              return { sku: variantSkus[0] ?? sku, publishError: blockReason };
            }
          } catch (e) {
            console.warn("[ebay] getListingFees failed for variant group; continuing", {
              sku,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
        try {
          const published = await publishOfferByInventoryItemGroup(
            conn.accessToken,
            groupKey
          ).catch(async (e) => {
            const msg = describeEbayThrownError(e);
            if (!/#25001\b|Internal Server Error/i.test(msg)) throw e;
            await new Promise((r) => setTimeout(r, 800));
            return publishOfferByInventoryItemGroup(conn.accessToken, groupKey);
          });
          await persistEbayVariantOptionSkus(item.id, item.variants, variantRows);
          let quantityError: string | undefined;
          try {
            await pushVariantGroupQuantities(conn.accessToken, variantRows, offerIdsBySku);
          } catch (qtyErr) {
            quantityError = describeEbayThrownError(qtyErr);
            console.warn("[ebay] variant quantity write after publish failed", {
              storeItemId: item.id,
              listingId: published?.listingId ?? null,
              error: quantityError,
            });
          }
          await completeTrace(trace, quantityError ? "failed" : "success");
          return { sku: variantSkus[0] ?? sku, listingId: published?.listingId, quantityError };
        } catch (e) {
          const msg = describeEbayThrownError(e);
          await completeTrace(trace, "failed", e);
          return { sku: variantSkus[0] ?? sku, publishError: msg };
        }
      }
      await persistEbayVariantOptionSkus(item.id, item.variants, variantRows);
      let variantQuantityError: string | undefined;
      try {
        await pushVariantGroupQuantities(conn.accessToken, variantRows, offerIdsBySku);
      } catch (qtyErr) {
        variantQuantityError = describeEbayThrownError(qtyErr);
        console.warn("[ebay] variant quantity write failed", {
          storeItemId: item.id,
          error: variantQuantityError,
        });
      }
      await completeTrace(trace, variantQuantityError ? "failed" : "success");
      return {
        sku: variantSkus[0] ?? sku,
        listingId: publishedVariantListingId ?? undefined,
        quantityError: variantQuantityError,
      };
    }

    async function pushInventoryWithConditionRetry() {
      try {
        await pushInventoryBody(inventoryBody, trace);
      } catch (e) {
        const msg = describeEbayThrownError(e);
        if (!isEbayConditionSyncError(msg)) throw e;
        prepared = await prepareEbaySyncCondition({
          accessToken: conn.accessToken,
          storeItemId: item.id,
          item: syncItem,
          categoryId: targetCategoryId ?? existingOfferCategoryId,
        });
        syncItem = prepared.item;
        console.warn("[ebay] upsertListing condition retry after 25021", {
          storeItemId: item.id,
          sku,
          syncConditionEnum: prepared.conditionEnum,
        });
        await pushInventoryBody(
          applyEbayInventoryPhotoPolicy(
            await finalizeInventoryBody(
              conn.accessToken,
              buildEbayInventoryItem(syncItem, pushAspects),
              {
                categoryId: aspectCategoryId,
                pushAspects,
                operation,
                item: syncItem,
              }
            ),
            {
              liveImageUrls: liveNativeImageUrls,
              inwPhotos: syncItem.photos,
              pushInwPhotos,
            }
          ),
          trace
        );
      }
    }

    // Existing offers: set category on the offer before updating inventory condition (eBay #25021).
    if (writeOffer && offerId) {
      await pushOfferBody(offerBody);
      await pushInventoryWithConditionRetry();
    } else {
      await pushInventoryWithConditionRetry();
      if (writeOffer) {
        await pushOfferBody(offerBody);
      }
    }

    const shouldPublish = shouldRepublishEbayOffer({
      operation,
      canPublish: cfg.canPublish,
      itemIsActive: item.status === "active",
      quantity: item.quantity,
      offerId,
      offerStatus:
        (typeof liveOffer?.status === "string" ? liveOffer.status : null) ??
        existingOffer?.status ??
        null,
    });
    let publishedListingId: string | undefined =
      readEbayOfferListingId(liveOffer) ?? readEbayOfferListingId(existingOffer) ?? undefined;
    if (shouldPublish && offerId) {
      const leftoverListingId =
        publishedListingId ?? resolveEbayLegacyListingId(linkExternalId);
      if (leftoverListingId) {
        try {
          await endEbayTradingItem(conn.accessToken, leftoverListingId);
          console.warn("[ebay] ended leftover live listing before republish", {
            storeItemId: item.id,
            leftoverListingId,
            offerId,
          });
        } catch (e) {
          console.warn("[ebay] leftover EndItem before republish", {
            leftoverListingId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (!hadOfferAtStart) {
        try {
          const fees = await getListingFees(conn.accessToken, [offerId]);
          const blockReason = getListingFeeBlockReason(fees);
          if (blockReason) {
            await completeTrace(trace, "failed", new Error(blockReason));
            return { sku, publishError: blockReason };
          }
          const feeSummary = formatListingFeeSummary(fees);
          if (feeSummary) {
            console.info("[ebay] publish listing fees", { offerId, feeSummary });
          }
        } catch (e) {
          console.warn("[ebay] getListingFees failed; continuing to publish", {
            offerId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      try {
        publishedListingId = await publishOffer(conn.accessToken, offerId);
        await persistRevisionCount(conn.id, sku, conn.config);
      } catch (e) {
        const msg = describeEbayThrownError(e);
        if (isEbayConditionSyncError(msg)) {
          prepared = await prepareEbaySyncCondition({
            accessToken: conn.accessToken,
            storeItemId: item.id,
            item: syncItem,
            categoryId: targetCategoryId ?? existingOfferCategoryId,
          });
          syncItem = prepared.item;
          console.warn("[ebay] upsertListing publish retry after 25021", {
            storeItemId: item.id,
            sku,
            syncConditionEnum: prepared.conditionEnum,
          });
          await pushInventoryBody(
            applyEbayInventoryPhotoPolicy(
              await finalizeInventoryBody(
                conn.accessToken,
                buildEbayInventoryItem(syncItem, pushAspects),
                {
                  categoryId: aspectCategoryId,
                  pushAspects,
                  operation,
                  item: syncItem,
                }
              ),
              {
                liveImageUrls: liveNativeImageUrls,
                inwPhotos: syncItem.photos,
                pushInwPhotos,
              }
            ),
            trace
          );
          publishedListingId = await publishOffer(conn.accessToken, offerId);
          await persistRevisionCount(conn.id, sku, conn.config);
        } else if (/already been published|already published/i.test(msg)) {
          publishedListingId =
            publishedListingId ??
            readEbayOfferListingId(liveOffer) ??
            readEbayOfferListingId(existingOffer) ??
            undefined;
          console.info("[ebay] publish skipped; offer already live", { offerId, listingId: publishedListingId });
        } else {
          console.error("[ebay] publish failed; left as draft", { offerId, error: msg });
          await completeTrace(trace, "failed", e);
          return { sku, publishError: msg };
        }
      }
    }

    if (
      publishedListingId &&
      ebayLink &&
      ebayLink.externalListingId !== publishedListingId
    ) {
      await prisma.channelListingLink
        .update({
          where: { id: ebayLink.id },
          data: { externalListingId: publishedListingId },
        })
        .catch((e) => {
          console.warn("[ebay] could not persist live listing id", {
            storeItemId: item.id,
            listingId: publishedListingId,
            error: e instanceof Error ? e.message : String(e),
          });
        });
    }

    await completeTrace(trace, "success");
    return { sku, listingId: publishedListingId };
  } catch (e) {
    await completeTrace(trace, "failed", e);
    throw e;
  }
}

/** Read-back: live listing stock is offer.availableQuantity, not inventory PUT. */
async function verifyOfferWrite(
  accessToken: string,
  offerId: string,
  expectedQuantity: number
): Promise<void> {
  await new Promise((r) => setTimeout(r, 500));
  const offer = await getOfferDetails(accessToken, offerId);
  if (!offer) return;
  const actual = Number(offer.availableQuantity);
  if (!Number.isFinite(actual) || actual === expectedQuantity) return;
  await new Promise((r) => setTimeout(r, 800));
  const retry = await getOfferDetails(accessToken, offerId);
  const retryQty = Number(retry?.availableQuantity);
  if (Number.isFinite(retryQty) && retryQty !== expectedQuantity) {
    throw new Error(
      `eBay offer verify failed for ${offerId}: expected ${expectedQuantity}, got ${retryQty}`
    );
  }
}

/**
 * Read-back verification: confirm the inventory quantity was actually applied.
 * This catches cases where eBay returns 200 OK but the stock didn't change.
 * @param expectedQuantity - The quantity we tried to set, or null to skip qty check (for variant listings)
 */
async function verifyInventoryWrite(
  accessToken: string,
  sku: string,
  expectedQuantity: number | null
): Promise<void> {
  // Small delay to allow eBay to propagate the write
  await new Promise((r) => setTimeout(r, 500));

  const item = await ebayGetInventoryItem(accessToken, sku);
  if (!item) {
    console.warn("[ebay] verifyInventoryWrite: inventory item not found after write", { sku });
    // Don't throw - the item might be newly created and still propagating
    return;
  }

  // For variant listings, we skip quantity check since it's per-variation
  if (expectedQuantity === null) return;

  const actualQuantity = item.availability?.shipToLocationAvailability?.quantity;
  if (actualQuantity !== undefined && actualQuantity !== expectedQuantity) {
    // One retry after a longer delay for eBay propagation.
    await new Promise((r) => setTimeout(r, 800));
    const retry = await ebayGetInventoryItem(accessToken, sku);
    const retryQty = retry?.availability?.shipToLocationAvailability?.quantity;
    if (retryQty !== undefined && retryQty !== expectedQuantity) {
      throw new Error(
        `eBay inventory verify failed for SKU ${sku}: expected ${expectedQuantity}, got ${retryQty}`
      );
    }
  }
}

export const ebayAdapter: ChannelAdapter = {
  provider: "ebay",

  getAuthUrl: getEbayAuthUrl,

  exchangeCode(args): Promise<TokenResponse> {
    return exchangeEbayCode(args);
  },

  refreshAccessToken(refreshToken): Promise<TokenResponse> {
    return refreshEbayToken(refreshToken);
  },

  fetchShopInfo(accessToken) {
    return fetchEbayShopInfo(accessToken);
  },

  async getInitialConfig(accessToken): Promise<Record<string, unknown>> {
    const cfg = await fetchEbayConnectionConfig(accessToken);

    const notif = await subscribeEbayInboundNotifications(accessToken);

    return {
      ...cfg,
      ...notif.configPatch,
    };
  },

  async createListing(conn, item): Promise<CreateListingResult> {
    const cfg = readEbayConfig(conn.config);
    if (!cfg.canPublish) {
      throw new Error(
        cfg.publishBlockReason ||
          "Complete eBay business policies and a merchant location in Sync Stores first."
      );
    }
    if (item.status !== "active" || item.quantity <= 0) {
      throw new Error("Item must be active with a quantity of at least 1 to list on eBay.");
    }
    const { sku, listingId, publishError, quantityError } = await upsertListing(conn, item);
    if (publishError) {
      throw new Error(publishError);
    }
    if (!listingId) {
      return {
        externalListingId: sku,
        externalShopId: conn.externalShopId,
        live: false,
        warning: "eBay saved a draft. It is not live on eBay yet.",
      };
    }
    // Listing is live; don't orphan it by throwing. Surface the qty failure as a warning so
    // the link is created and the seller sees that quantities still need to sync.
    return {
      externalListingId: listingId,
      externalShopId: conn.externalShopId,
      live: true,
      ...(quantityError
        ? { warning: `eBay listing is live but the variation quantities failed to update: ${quantityError}` }
        : {}),
    };
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    const result = await upsertListing(conn, item, externalListingId);
    const outcome = classifyEbayUpsertResult(result);
    if (outcome.kind === "publish_error") {
      if (isEbayConditionSyncError(outcome.message)) {
        throw new Error(outcome.message);
      }
      throw new Error(`eBay content updated but publish failed: ${outcome.message}`);
    }
    // A published listing whose variation quantities didn't write is NOT a success — surface it
    // so it becomes a Needs Attention item and the retry queue re-attempts the quantity write.
    if (outcome.kind === "quantity_error") {
      throw new Error(
        `eBay listing updated but variation quantities failed to sync: ${outcome.message}`
      );
    }
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    const link = await prisma.channelListingLink.findFirst({
      where: { connectionId: conn.id, provider: "ebay", externalListingId },
      select: { linkOrigin: true, storeItemId: true, storeItem: { select: { sku: true } } },
    });
    const sku = resolveEbayPushSku({
      itemId: link?.storeItemId ?? externalListingId,
      itemSku: link?.storeItem?.sku,
      externalListingId,
      linkOrigin: link?.linkOrigin,
    });
    const offer = await findOffer(conn.accessToken, sku);
    let withdrewOffer = false;
    if (offer?.offerId) {
      try {
        await ebayAction(conn.accessToken, `/sell/inventory/v1/offer/${offer.offerId}/withdraw`, "POST");
        withdrewOffer = true;
      } catch (e) {
        if (!(e instanceof EbayApiError && e.status === 404)) {
          console.warn("[ebay] offer withdraw failed; trying EndItem", {
            sku,
            offerId: offer.offerId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const fromOffer =
      offer?.listing?.listingId != null ? String(offer.listing.listingId).trim() : "";
    const listingId =
      (fromOffer && /^\d+$/.test(fromOffer) ? fromOffer : null) ??
      resolveEbayLegacyListingId(externalListingId);
    if (listingId) {
      try {
        await endEbayTradingItem(conn.accessToken, listingId);
        return;
      } catch (e) {
        if (withdrewOffer) {
          console.warn("[ebay] EndItem after withdraw failed", {
            listingId,
            error: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        throw e;
      }
    }

    if (withdrewOffer) return;
    // No live listing id and nothing to withdraw — already off eBay.
    return;
  },

  async updateInventory(conn, externalListingId, absoluteQuantity, item): Promise<void> {
    const ebayLink = await prisma.channelListingLink.findFirst({
      where: { storeItemId: item.id, provider: "ebay" },
      select: {
        id: true,
        linkOrigin: true,
        externalListingId: true,
        ebayInventoryAspects: true,
        conflictDetails: true,
      },
    });
    if (isEbayListingEnded(ebayLink?.conflictDetails)) {
      console.info("[ebay] skip inventory update; listing ended", {
        storeItemId: item.id,
        sku: ebayLink?.externalListingId,
      });
      return;
    }
    const inventorySku = resolveEbayPushSku({
      itemId: item.id,
      itemSku: item.sku,
      externalListingId,
      linkOrigin: ebayLink?.linkOrigin,
    });
    hydrateRevisionCountsFromConfig(conn.config);

    try {
      // Check rate limit before making any changes
      const limitCheck = checkRevisionLimit(inventorySku);
      if (limitCheck.atLimit) {
        const warning = getRevisionLimitWarning(inventorySku);
        throw new Error(warning || "eBay daily revision limit reached");
      }
      if (limitCheck.nearLimit) {
        console.warn("[ebay] updateInventory: approaching rate limit", {
          sku: inventorySku,
          count: limitCheck.count,
        });
      }

      const isImported = isImportedEbayLink({
        provider: "ebay",
        externalListingId,
        storeItemId: item.id,
        linkOrigin: ebayLink?.linkOrigin,
      });

      const offer = await findOffer(conn.accessToken, inventorySku).catch(() => null);
      if (
        offer?.status &&
        shouldSkipEbayUnpublishedZeroQuantitySync({
          quantity: Math.max(0, absoluteQuantity),
          offerStatus: offer.status,
        })
      ) {
        console.info("[ebay] skip unpublished zero-qty inventory update", {
          storeItemId: item.id,
          sku: inventorySku,
          offerId: offer.offerId,
          offerStatus: offer.status,
        });
        return;
      }

      if (hasOptionQuantities(item.variants) && shouldUseInventoryItemGroup(item)) {
        let variantRows = buildVariantInventoryRows(item, {
          parentSku: inventorySku,
          legacyListingId: resolveEbayLegacyListingId(externalListingId),
          imported: isImported,
        });
        const liveGroup = await resolveLiveEbayInventoryItemGroup(
          conn.accessToken,
          item,
          inventorySku
        );
        variantRows = await alignVariantRowsToLiveEbayInventory(
          conn.accessToken,
          variantRows,
          readInventoryItemGroupVariantSkus(liveGroup.body)
        );
        await pushVariantGroupQuantities(conn.accessToken, variantRows);
        await persistEbayVariantOptionSkus(item.id, item.variants, variantRows);
        return;
      }

      if (hasOptionQuantities(item.variants)) {
        const quantity = Math.max(0, absoluteQuantity);
        await pushEbayAbsoluteQuantity({
          accessToken: conn.accessToken,
          sku: inventorySku,
          quantity,
          offerId: offer?.offerId,
          title: item.title,
        });
        await persistRevisionCount(conn.id, inventorySku, conn.config);
        if (quantity <= 0) {
          if (offer?.offerId) {
            await verifyOfferWrite(conn.accessToken, offer.offerId, 0);
          }
        } else {
          await verifyInventoryWrite(conn.accessToken, inventorySku, quantity);
        }
        return;
      }
      const quantity = Math.max(0, absoluteQuantity);
      await pushEbayAbsoluteQuantity({
        accessToken: conn.accessToken,
        sku: inventorySku,
        quantity,
        offerId: offer?.offerId,
        title: item.title,
      });
      await persistRevisionCount(conn.id, inventorySku, conn.config);

      if (quantity <= 0) {
        if (offer?.offerId) {
          await verifyOfferWrite(conn.accessToken, offer.offerId, 0);
        }
      } else {
        await verifyInventoryWrite(conn.accessToken, inventorySku, quantity);
      }
    } catch (e) {
      const msg = describeEbayThrownError(e);
      if (ebayLink && (isEbayEndedListingError(e) || isEbayEndedListingError(msg))) {
        await persistEbayListingEnded(ebayLink.id, ebayLink.conflictDetails);
        return;
      }
      throw e;
    }
  },

  async listRemoteListings(conn, opts?: { skipPhotoEnrichment?: boolean }): Promise<RemoteListingSummary[]> {
    const tradingListings = await enumerateEbayListings(conn.accessToken, {
      skipPhotoEnrichment: opts?.skipPhotoEnrichment,
    });
    const inventoryRows = await listInventoryItems(conn.accessToken).catch((e) => {
      console.warn("[ebay] listInventoryItems failed during import", {
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    });
    const listings = mergeInventoryRowsWithTrading(tradingListings, inventoryRows);
    const invBySku = new Map(
      inventoryRows
        .filter((row) => row.sku?.trim())
        .map((row) => [row.sku!.trim(), row] as const)
    );
    const offerIndex = await listEbayOfferFulfillmentPolicies(conn.accessToken, {
      fallbackSkus: [
        ...inventoryRows.map((row) => row.sku),
        ...tradingListings.map((row) => row.sku),
      ].filter((sku): sku is string => Boolean(sku?.trim())),
    }).catch((e) => {
      console.warn("[ebay] listEbayOfferFulfillmentPolicies failed during import", {
        error: e instanceof Error ? e.message : String(e),
      });
      return emptyOfferFulfillmentIndex();
    });
    return listings.map((l) => {
      const inv = l.sku?.trim() ? invBySku.get(l.sku.trim()) : undefined;
      return ebayListingToSummary({
        listingId: l.listingId,
        title: l.title,
        price: { value: (l.priceCents / 100).toFixed(2), currency: "USD" },
        availableQuantity: l.quantity,
        imageUrls: l.photos,
        categoryId: l.remoteCategoryId ?? null,
        categoryName: l.categoryName ?? null,
        remoteUpdatedAt: l.remoteUpdatedAt ?? null,
        sku: l.sku ?? undefined,
        packageWeightAndSize: inv?.packageWeightAndSize,
        remoteShippingProfileId: resolveEbayListingFulfillmentPolicyId({
          tradingProfileId: l.remoteShippingProfileId,
          listingId: l.listingId,
          sku: l.sku,
          offerIndex,
        }),
      });
    });
  },

  async fetchProductQuantity(
    conn,
    externalListingId
  ): Promise<{ quantity: number; known: boolean }> {
    let legacyId = externalListingId;
    const inwMatch = legacyId.match(/^inw(\d+)$/);
    if (inwMatch) legacyId = inwMatch[1];

    // Prefer Inventory API for INW-created SKUs; fall back to Trading GetItem for classic IDs.
    const inv = await ebayGetInventoryItem(conn.accessToken, externalListingId).catch(() => null);
    const invQty = inv?.availability?.shipToLocationAvailability?.quantity;
    if (typeof invQty === "number") {
      return { quantity: Math.max(0, invQty), known: true };
    }

    if (/^\d+$/.test(legacyId)) {
      try {
        const details = await fetchEbayItemDetails(conn.accessToken, legacyId);
        if (details.quantity != null) {
          return { quantity: details.quantity, known: true };
        }
      } catch {
        return { quantity: 0, known: false };
      }
    }
    return { quantity: 0, known: false };
  },

  async fetchRecentSales(conn, since): Promise<RemoteSale[]> {
    const sinceIso = since.toISOString();
    const sales: RemoteSale[] = [];
    let offset = 0;
    for (let page = 0; page < 5; page += 1) {
      const res = await ebayGet<{
        orders?: {
          orderId?: string;
          lineItems?: {
            lineItemId?: string;
            sku?: string;
            legacyItemId?: string;
            quantity?: number;
          }[];
        }[];
        total?: number;
      }>(
        conn.accessToken,
        `/sell/fulfillment/v1/order?filter=creationdate:%5B${encodeURIComponent(sinceIso)}..%5D&limit=200&offset=${offset}`
      );
      const orders = res?.orders ?? [];
      for (const order of orders) {
        for (const li of order.lineItems ?? []) {
          const sale = ebayFulfillmentLineToSale(order.orderId, li);
          if (!sale) {
            console.warn("[ebay] sale line without SKU or legacy Item ID; cannot reconcile", {
              orderId: order.orderId,
              lineItemId: li.lineItemId,
            });
            continue;
          }
          sales.push(sale);
        }
      }
      if (orders.length < 200) break;
      offset += 200;
    }
    return sales;
  },
};
