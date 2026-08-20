import type {
  ChannelAdapter,
  ChannelConnectionContext,
  CreateListingResult,
  RemoteListingSummary,
  RemoteSale,
  SyncStoreItem,
  TokenResponse,
} from "../types";
import { EbayApiError, ebayAction, ebayGet, ebayGetInventoryItem, ebayJson, takeEbayCallWarnings } from "./client";
import {
  describeEbayThrownError,
  formatEbayErrorDiagnostics,
  isEbayInventoryAspectValidationError,
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
  isEbayConditionSyncError,
  preserveOrBuildConditionDescriptorsOnBody,
  summarizeConditionDescriptors,
  type EbayInventoryConditionDescriptor,
} from "./conditions";
import { resolveRemappedEbayCategoryId } from "./expired-categories";
import { getItemAspectsForCategory } from "./aspects";
import { formatListingFeeSummary, getListingFeeBlockReason, getListingFees } from "./fees";
import {
  buildInventoryItemGroupBody,
  buildVariantInventorySkus,
  createOrReplaceInventoryItemGroup,
  publishOfferByInventoryItemGroup,
  shouldUseInventoryItemGroup,
} from "./inventory-groups";
import { listInventoryItems, mergeInventoryRowsWithTrading } from "./inventory-import";
import { ensureEbayHostedPhotoUrls, isEbayImageRelatedInventoryError } from "./media";
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
import { hasOptionQuantities } from "../../store-item-variants";
import {
  enumerateEbayListings,
  fetchEbayItemDetails,
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
import { isImportedEbayLink, extractEbayInventoryAspects, resolveEbayInventorySku } from "./listing-origin";
import { passthroughUsePreparedInventoryAspects } from "./aspect-prep";
import {
  buildPassthroughInventoryContentPutBody,
  buildPassthroughLiveOverlayBody,
  detectLivePassthroughChanges,
  fetchLiveInventoryItem,
  formatPassthroughFieldSyncSummary,
  formatPassthroughPutNote,
  needsInventoryPut,
  overlayPassthroughOffer,
  passthroughAllAttemptedFailed,
  passthroughSyncHasFailures,
  readOfferPriceCents,
  resolvePassthroughChanges,
  type PassthroughBuildOptions,
  type PassthroughFieldResult,
} from "./passthrough-push";
import { bestOfferStatesMatch, inwBestOfferState, readOfferBestOfferTerms } from "./best-offer";
import { fetchAndCacheEbayInventoryAspects } from "./inventory-aspects-cache";
import { detectStoreItemFieldChanges } from "../sync-baseline";
import type { ListingAspect } from "@/lib/listing-limits";

type EbayOffer = { offerId?: string; status?: string; listing?: { listingId?: string } };
type OfferSearch = { offers?: EbayOffer[] };

/** Find the first offer for a SKU (used to resolve offerId from the stored SKU). */
async function findOffer(accessToken: string, sku: string): Promise<EbayOffer | null> {
  try {
    const res = await ebayGet<OfferSearch>(
      accessToken,
      `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
    );
    return res.offers?.[0] ?? null;
  } catch (e) {
    if (e instanceof EbayApiError && e.status === 404) return null;
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
    if (e instanceof EbayApiError && e.status === 404) return null;
    throw e;
  }
}

async function publishOffer(accessToken: string, offerId: string): Promise<void> {
  await ebayAction(accessToken, `/sell/inventory/v1/offer/${offerId}/publish`, "POST");
}

async function finalizeInventoryBody(
  accessToken: string,
  body: Record<string, unknown>,
  args: {
    categoryId: string | null;
    pushAspects: ListingAspect[];
    operation: "create" | "update";
    item: SyncStoreItem;
  }
): Promise<Record<string, unknown>> {
  const productAspects = aspectsToEbayProductAspects(args.pushAspects);
  if (args.categoryId) {
    try {
      const descriptorMeta = await fetchConditionDescriptorMetadata(accessToken, args.categoryId);
      body = appendConditionDescriptorsToInventoryBody(
        body,
        productAspects,
        descriptorMeta,
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
  if (args.operation === "create") {
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
type UpsertResult = { sku: string; publishError?: string };

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
      connection: { select: { memberId: true } },
    },
  });
  const linkExternalId = linkedSku ?? ebayLink?.externalListingId ?? item.id;
  const sku = resolveEbayInventorySku(linkExternalId);
  const operation = linkedSku || ebayLink ? "update" : "create";
  
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

    const cat = await resolveProviderCategoryId(conn, "ebay", item.category);
    let targetCategoryId = resolveCategoryId(item, cat.ebayCategoryId ?? null);
    targetCategoryId = await resolveRemappedEbayCategoryId(targetCategoryId, {
      storeItemId: item.id,
      persist: true,
      currentStoredId: item.ebayCategoryId,
      persistCategoryId: persistEbayCategoryId,
    });

    const existingOffer = await findOffer(conn.accessToken, sku);
    const hadOfferAtStart = Boolean(existingOffer?.offerId);
    let offerId = existingOffer?.offerId ?? null;
    let existingOfferCategoryId: string | null = null;
    let liveOffer: Record<string, unknown> | null = null;
    if (offerId) {
      liveOffer = await getOfferDetails(conn.accessToken, offerId);
      const rawCategory = liveOffer?.categoryId;
      existingOfferCategoryId = typeof rawCategory === "string" ? rawCategory.trim() : null;
      existingOfferCategoryId = await resolveRemappedEbayCategoryId(existingOfferCategoryId, {
        storeItemId: item.id,
        persist: true,
        currentStoredId: item.ebayCategoryId,
        persistCategoryId: persistEbayCategoryId,
      });
    }

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

      const liveChanges = detectLivePassthroughChanges(live, item, liveOffer);
      const inwFields = detectStoreItemFieldChanges(item, ebayLink?.lastPushedHash);
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
      let categoryAspects: Awaited<ReturnType<typeof getItemAspectsForCategory>> = [];
      if (needsInventoryAspectContext) {
        if (legacyListingId) {
          try {
            const details = await fetchEbayItemDetails(conn.accessToken, legacyListingId);
            tradingAspects = aspectsToEbayProductAspects(parseStoredAspects(details.aspects));
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
            categoryAspects = await getItemAspectsForCategory(offerCategoryId);
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
        const quantity = Math.max(0, item.quantity);
        const request: Record<string, unknown> = {
          sku,
          shipToLocationAvailability: { quantity },
        };
        if (offerId) {
          request.offers = [{ offerId, availableQuantity: quantity }];
        }
        const bulkFields: PassthroughFieldResult[] = [{ field: "quantity", ok: false }];
        try {
          await ebayJson(conn.accessToken, `/sell/inventory/v1/bulk_update_price_quantity`, "POST", {
            requests: [request],
          });
          await persistRevisionCount(conn.id, sku, conn.config);
          bulkFields[0]!.ok = true;
        } catch (e) {
          const msg = describeEbayThrownError(e);
          bulkFields[0]!.error = msg;
          if (e instanceof EbayApiError) {
            addResponse(trace, e.status, { error: e.message, body: e.body });
          }
        }
        fieldResults.push(...bulkFields);
      }

      const pushInventoryContent = changed.title === true || putInventory;
      let inventoryContentPutOk = !pushInventoryContent;

      if (pushInventoryContent) {
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
        let contentPutOk = false;
        try {
          await ebayJson(
            conn.accessToken,
            `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
            "PUT",
            inventoryBody
          );
          await persistRevisionCount(conn.id, sku, conn.config);
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
              await ebayJson(
                conn.accessToken,
                `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
                "PUT",
                inventoryBody
              );
              await persistRevisionCount(conn.id, sku, conn.config);
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
            const msg = `${describeEbayThrownError(e)}. ${putNote}`;
            if (changed.title) {
              fieldResults.push({ field: "title", ok: false, error: msg });
            }
            if (putInventory) {
              fieldResults.push({ field: "photos", ok: false, error: msg });
            }
          }
        }
        if (contentPutOk) {
          if (changed.title) fieldResults.push({ field: "title", ok: true });
          if (putInventory) fieldResults.push({ field: "photos", ok: true });
        }
        inventoryContentPutOk = contentPutOk;
      }

      if (
        (changed.price || changed.description || changed.bestOffer) &&
        inventoryContentPutOk
      ) {
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
      } else if (
        (changed.price || changed.description || changed.bestOffer) &&
        !inventoryContentPutOk
      ) {
        const blockedError = "Skipped eBay offer update because inventory content update failed.";
        if (changed.price) fieldResults.push({ field: "price", ok: false, error: blockedError });
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
    let liveCategoryId: string | null = null;
    if (legacyListingId) {
      try {
        const liveDetails = await fetchEbayItemDetails(conn.accessToken, legacyListingId);
        liveTradingAspects = liveDetails.aspects;
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

    // Validate aspects
    if (aspectPrep.missingRequired.length > 0) {
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

    console.warn("[ebay] upsertListing condition", {
      storeItemId: item.id,
      sku,
      targetCategoryId,
      existingOfferCategoryId,
      conditionCategoryId,
      syncConditionEnum: prepared.conditionEnum,
      autoCorrected: prepared.autoCorrected,
      enrichedFromEbay: workingItem.ebayConditionEnum !== item.ebayConditionEnum,
      hasExistingOffer: !!offerId,
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

    async function pushInventoryBody(body: Record<string, unknown>, traceCtx?: SyncTraceContext) {
      if (traceCtx) {
        addRequest(traceCtx, body);
      }
      const putInventory = async (payload: Record<string, unknown>) => {
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
      };
      try {
        await putInventory(body);
      } catch (e) {
        const msg = describeEbayThrownError(e);
        const product =
          body.product && typeof body.product === "object"
            ? (body.product as Record<string, unknown>)
            : null;
        const imageUrls = Array.isArray(product?.imageUrls)
          ? product.imageUrls.filter((url): url is string => typeof url === "string")
          : [];
        if (isEbayImageRelatedInventoryError(msg) && imageUrls.length > 0) {
          const hosted = await ensureEbayHostedPhotoUrls(conn.accessToken, imageUrls);
          const retryBody = {
            ...body,
            product: { ...(product ?? {}), imageUrls: hosted },
          };
          await putInventory(retryBody);
          return;
        }
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
    const offerBody = buildEbayOffer(syncItem, cfg, aspectCategoryId, sku);

    if (shouldUseInventoryItemGroup(syncItem)) {
      const variantSkus = buildVariantInventorySkus(syncItem);
      for (const variantSku of variantSkus) {
        const variantBody = await finalizeInventoryBody(
          conn.accessToken,
          buildEbayInventoryItem({ ...syncItem, sku: variantSku }, pushAspects),
          {
            categoryId: aspectCategoryId,
            pushAspects,
            operation,
            item: syncItem,
          }
        );
        await ebayJson(
          conn.accessToken,
          `/sell/inventory/v1/inventory_item/${encodeURIComponent(variantSku)}`,
          "PUT",
          variantBody
        );
        const variantOffer = await findOffer(conn.accessToken, variantSku);
        const variantOfferBody = buildEbayOffer(
          { ...syncItem, sku: variantSku },
          cfg,
          aspectCategoryId,
          variantSku
        );
        if (variantOffer?.offerId) {
          await ebayJson(
            conn.accessToken,
            `/sell/inventory/v1/offer/${variantOffer.offerId}`,
            "PUT",
            variantOfferBody
          );
        } else {
          await ebayJson(conn.accessToken, `/sell/inventory/v1/offer`, "POST", variantOfferBody);
        }
      }
      await createOrReplaceInventoryItemGroup(
        conn.accessToken,
        buildInventoryItemGroupBody(syncItem, variantSkus)
      );
      const shouldPublishGroup =
        cfg.canPublish && item.status === "active" && item.quantity > 0 && !hadOfferAtStart;
      if (shouldPublishGroup) {
        if (!hadOfferAtStart) {
          try {
            const fees = await getListingFees(
              conn.accessToken,
              (
                await Promise.all(
                  variantSkus.map(async (variantSku) => (await findOffer(conn.accessToken, variantSku))?.offerId)
                )
              ).filter((id): id is string => Boolean(id))
            );
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
          await publishOfferByInventoryItemGroup(
            conn.accessToken,
            buildInventoryItemGroupBody(syncItem, variantSkus).inventoryItemGroupKey as string
          );
        } catch (e) {
          const msg = describeEbayThrownError(e);
          await completeTrace(trace, "failed", e);
          return { sku: variantSkus[0] ?? sku, publishError: msg };
        }
      }
      await completeTrace(trace, "success");
      return { sku: variantSkus[0] ?? sku };
    }

    // Existing offers: set category on the offer before updating inventory condition (eBay #25021).
    if (offerId) {
      await pushOfferBody(offerBody);
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
          trace
        );
      }
    } else {
      await pushInventoryBody(inventoryBody, trace);
      await pushOfferBody(offerBody);
    }

    const shouldPublish = cfg.canPublish && item.status === "active" && item.quantity > 0 && !!offerId;
    if (shouldPublish && offerId) {
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
        await publishOffer(conn.accessToken, offerId);
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
            trace
          );
          await publishOffer(conn.accessToken, offerId);
          await persistRevisionCount(conn.id, sku, conn.config);
        } else {
          console.error("[ebay] publish failed; left as draft", { offerId, error: msg });
          await completeTrace(trace, "failed", e);
          return { sku, publishError: msg };
        }
      }
    }

    await completeTrace(trace, "success");
    return { sku };
  } catch (e) {
    await completeTrace(trace, "failed", e);
    throw e;
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
    const { sku, publishError } = await upsertListing(conn, item);
    if (publishError) {
      console.warn("[ebay] createListing: inventory item + offer saved, but publish failed", {
        sku,
        publishError,
      });
    }
    return { externalListingId: sku, externalShopId: conn.externalShopId };
  },

  async updateListing(conn, externalListingId, item): Promise<void> {
    const { publishError } = await upsertListing(conn, item, externalListingId);
    if (publishError) {
      if (isEbayConditionSyncError(publishError)) {
        throw new Error(publishError);
      }
      throw new Error(`eBay content updated but publish failed: ${publishError}`);
    }
  },

  async deleteListing(conn, externalListingId): Promise<void> {
    const sku = externalListingId;
    const offer = await findOffer(conn.accessToken, sku).catch(() => null);
    if (offer?.offerId) {
      try {
        await ebayAction(conn.accessToken, `/sell/inventory/v1/offer/${offer.offerId}/withdraw`, "POST");
      } catch (e) {
        if (!(e instanceof EbayApiError && e.status === 404)) throw e;
      }
    }
  },

  async updateInventory(conn, externalListingId, absoluteQuantity, item): Promise<void> {
    const ebayLink = await prisma.channelListingLink.findFirst({
      where: { storeItemId: item.id, provider: "ebay" },
      select: { linkOrigin: true, externalListingId: true, ebayInventoryAspects: true },
    });
    const inventorySku = resolveEbayInventorySku(externalListingId);
    hydrateRevisionCountsFromConfig(conn.config);

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

    if (hasOptionQuantities(item.variants)) {
      const qtyItem = { ...item, quantity: Math.max(0, absoluteQuantity) };
      let inventoryBody: Record<string, unknown>;
      if (isImported) {
        const live = await fetchLiveInventoryItem(conn.accessToken, inventorySku);
        if (!live) {
          throw new Error("Could not fetch live eBay inventory for passthrough qty update");
        }
        inventoryBody = buildPassthroughLiveOverlayBody(live, {
          quantity: Math.max(0, absoluteQuantity),
        });
      } else {
        inventoryBody = buildEbayInventoryItem(qtyItem);
      }
      await ebayJson(
        conn.accessToken,
        `/sell/inventory/v1/inventory_item/${encodeURIComponent(inventorySku)}`,
        "PUT",
        inventoryBody
      );
      await persistRevisionCount(conn.id, inventorySku, conn.config);
      await verifyInventoryWrite(conn.accessToken, inventorySku, null);
      return;
    }
    const quantity = Math.max(0, absoluteQuantity);
    const offer = await findOffer(conn.accessToken, inventorySku).catch(() => null);
    const request: Record<string, unknown> = {
      sku: inventorySku,
      shipToLocationAvailability: { quantity },
    };
    if (offer?.offerId) {
      request.offers = [{ offerId: offer.offerId, availableQuantity: quantity }];
    }
    await ebayJson(conn.accessToken, `/sell/inventory/v1/bulk_update_price_quantity`, "POST", {
      requests: [request],
    });
    await persistRevisionCount(conn.id, inventorySku, conn.config);

    await verifyInventoryWrite(conn.accessToken, inventorySku, quantity);
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
    return listings.map((l) =>
      ebayListingToSummary({
        listingId: l.listingId,
        title: l.title,
        price: { value: (l.priceCents / 100).toFixed(2), currency: "USD" },
        availableQuantity: l.quantity,
        imageUrls: l.photos,
        categoryId: l.remoteCategoryId ?? null,
        categoryName: l.categoryName ?? null,
        remoteUpdatedAt: l.remoteUpdatedAt ?? null,
        sku: l.sku ?? undefined,
      })
    );
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
      const details = await fetchEbayItemDetails(conn.accessToken, legacyId);
      if (details.quantity != null) {
        return { quantity: details.quantity, known: true };
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
          const sku = li.sku || null;
          if (!sku) {
            console.warn("[ebay] sale line without SKU (legacy listing); cannot reconcile", {
              orderId: order.orderId,
              lineItemId: li.lineItemId,
              legacyItemId: li.legacyItemId,
            });
            continue;
          }
          sales.push({
            externalEventId: `order:${order.orderId}:line:${li.lineItemId}`,
            externalListingId: sku,
            quantitySold: Math.max(1, li.quantity ?? 1),
            sku,
          });
        }
      }
      if (orders.length < 200) break;
      offset += 200;
    }
    return sales;
  },
};
