import {
  EBAY_API_BASE,
  EBAY_TRADING_COMPAT_LEVEL,
  EBAY_TRADING_SITE_ID,
} from "./config";
import { ebayJson } from "./client";
import { EbayApiError } from "./errors";
import { describeEbayThrownError, extractBulkMigrateResponse, formatMigrateListingError } from "./errors";
import { allTags, extractEbayItemPhotos, tag } from "./photos";
import {
  parseEbayDescription,
  parseEbayItemSpecifics,
  parseEbayPrimaryCategory,
} from "./item-specifics";
import type { ListingAspect } from "@/lib/listing-limits";

/** A classic (Trading API) eBay listing enumerated for import preview. */
export type EbayTradingListing = {
  listingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  photos: string[];
  /** eBay leaf category id (from PrimaryCategory) when known. */
  remoteCategoryId?: string | null;
  categoryName?: string | null;
};

/** Full item specifics + description + photos for a listing (fetched on import, not preview). */
export type EbayItemDetails = {
  aspects: ListingAspect[];
  remoteCategoryId: string | null;
  categoryName: string | null;
  description: string | null;
  /** All photos from GetItem (gallery + PictureDetails). */
  photos: string[];
};

const TRADING_ENDPOINT = `${EBAY_API_BASE}/ws/api.dll`;

function buildGetMyeBaySellingXml(pageNumber: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>100</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
}

function buildGetItemXml(listingId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${listingId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`;
}

async function callTrading(accessToken: string, callName: string, xml: string): Promise<string> {
  const res = await fetch(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": EBAY_TRADING_SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": EBAY_TRADING_COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml",
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`eBay Trading ${callName} failed (${res.status}).`);
  }
  return text;
}

/** Fallback when GetMyeBaySelling omits picture URLs (common for gallery-only rows). */
async function fetchEbayItemPhotos(accessToken: string, listingId: string): Promise<string[]> {
  try {
    const xml = await callTrading(accessToken, "GetItem", buildGetItemXml(listingId));
    const item = tag(xml, "Item") ?? xml;
    return extractEbayItemPhotos(item);
  } catch {
    return [];
  }
}

/**
 * Fetch full item specifics + primary category + description + photos for one listing via GetItem.
 * Used on import (not preview) so we round-trip the details eBay requires for two-way sync.
 *
 * Note: GetMyeBaySelling often returns only 1 gallery photo per listing; GetItem returns all photos,
 * so we fetch them here to ensure full photo import.
 */
export async function fetchEbayItemDetails(
  accessToken: string,
  listingId: string
): Promise<EbayItemDetails> {
  try {
    const xml = await callTrading(accessToken, "GetItem", buildGetItemXml(listingId));
    
    // Log raw response size and check for errors
    console.log("[ebay] GetItem raw response", {
      listingId,
      responseLength: xml.length,
      hasAck: xml.includes("<Ack>"),
      ackValue: xml.match(/<Ack>(\w+)<\/Ack>/)?.[1] || "unknown",
    });
    
    const item = tag(xml, "Item") ?? xml;
    
    // Log what we found in the Item section
    console.log("[ebay] GetItem Item section", {
      listingId,
      itemLength: item.length,
      hasPictureDetails: item.includes("<PictureDetails>"),
      hasPictureURL: item.includes("<PictureURL>"),
      hasItemSpecifics: item.includes("<ItemSpecifics>"),
      hasNameValueList: item.includes("<NameValueList>"),
      hasPrimaryCategory: item.includes("<PrimaryCategory>"),
    });
    
    const { categoryId, categoryName } = parseEbayPrimaryCategory(item);
    const aspects = parseEbayItemSpecifics(item);
    const photos = extractEbayItemPhotos(item);

    // Debug logging for import issues
    console.log("[ebay] fetchEbayItemDetails parsed result", {
      listingId,
      aspectsCount: aspects.length,
      photosCount: photos.length,
      categoryId,
      categoryName,
      hasDescription: !!parseEbayDescription(item),
      firstAspect: aspects[0] || null,
      firstPhoto: photos[0]?.slice(0, 80) || null,
    });

    if (aspects.length === 0 && item.includes("<ItemSpecifics>")) {
      // Log the actual ItemSpecifics section for debugging
      const specificsSection = tag(item, "ItemSpecifics");
      console.warn("[ebay] ItemSpecifics found but no aspects parsed", {
        listingId,
        specificsPreview: specificsSection?.slice(0, 500) || "null",
      });
    }
    
    if (photos.length === 0 && item.includes("<PictureDetails>")) {
      // Log the actual PictureDetails section for debugging
      const pictureSection = tag(item, "PictureDetails");
      console.warn("[ebay] PictureDetails found but no photos parsed", {
        listingId,
        picturePreview: pictureSection?.slice(0, 500) || "null",
      });
    }

    return {
      aspects,
      remoteCategoryId: categoryId,
      categoryName,
      description: parseEbayDescription(item),
      photos,
    };
  } catch (e) {
    console.error("[ebay] fetchEbayItemDetails failed", { listingId, error: e instanceof Error ? e.message : String(e) });
    return { aspects: [], remoteCategoryId: null, categoryName: null, description: null, photos: [] };
  }
}

/**
 * Fill in photos for listings where GetMyeBaySelling omitted them (gallery-only rows).
 *
 * NOTE: We deliberately do NOT use the Inventory API `getOffers` endpoint here. That
 * endpoint REQUIRES a `sku` query parameter and can only see offers created through the
 * Inventory API — classic website listings are invisible to it. GetItem (Trading API)
 * works for every active listing, so we use it directly.
 */
async function enrichPhotosViaGetItem(
  accessToken: string,
  listings: EbayTradingListing[]
): Promise<void> {
  const needs = listings.filter((l) => l.photos.length === 0);
  if (needs.length === 0) return;

  for (const listing of needs) {
    const fromGetItem = await fetchEbayItemPhotos(accessToken, listing.listingId);
    if (fromGetItem.length > 0) listing.photos = fromGetItem;
  }
}

/** Enumerate the seller's active classic listings via Trading API GetMyeBaySelling. */
export async function enumerateEbayListings(accessToken: string): Promise<EbayTradingListing[]> {
  const out: EbayTradingListing[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const xml = await callTrading(accessToken, "GetMyeBaySelling", buildGetMyeBaySellingXml(page));
    const activeList = tag(xml, "ActiveList") ?? "";
    const itemArray = tag(activeList, "ItemArray") ?? "";
    const items = allTags(itemArray, "Item");
    if (items.length === 0) break;
    for (const item of items) {
      const listingId = tag(item, "ItemID");
      if (!listingId) continue;
      const title = tag(item, "Title") ?? "eBay listing";
      const sellingStatus = tag(item, "SellingStatus") ?? "";
      const priceStr = tag(sellingStatus, "CurrentPrice") ?? tag(item, "CurrentPrice") ?? "0";
      const priceCents = Math.round((Number(priceStr) || 0) * 100);
      const qtyStr = tag(item, "QuantityAvailable") ?? tag(item, "Quantity") ?? "0";
      const quantity = Math.max(0, Number(qtyStr) || 0);
      const photos = extractEbayItemPhotos(item);
      const { categoryId, categoryName } = parseEbayPrimaryCategory(item);
      out.push({
        listingId,
        title,
        priceCents,
        quantity,
        photos,
        remoteCategoryId: categoryId,
        categoryName,
      });
    }
    // Stop early if this page was not full (no further pages).
    if (items.length < 100) break;
  }
  await enrichPhotosViaGetItem(accessToken, out);
  return out;
}

type MigrateResponse = {
  responses?: {
    listingId?: string;
    statusCode?: number;
    inventoryItems?: { sku?: string; offerId?: string }[];
    offers?: { offerId?: string }[];
    errors?: { errorId?: number; message?: string; longMessage?: string }[];
  }[];
};

export type MigrationResult = { sku?: string; offerId?: string; error?: string };

function formatMigrationError(e: unknown): string {
  return describeEbayThrownError(e);
}

/** Inventory API SKU for a migrated listing. Must be alphanumeric and <= 50 chars. */
function generateMigrationSku(listingId: string): string {
  return `inw${listingId}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
}

/**
 * eBay's bulkMigrateListing REQUIRES that the listing already has a seller-defined SKU
 * (Custom Label). Listings created on the eBay website usually have none, so migration
 * fails with a "no SKU" error. eBay's documented remediation is to ReviseFixedPriceItem
 * to add a SKU, then migrate again — that's what this detects.
 */
function migrationErrorLikelyMissingSku(reason: string): boolean {
  if (!reason) return false;
  // Listing tracked by SKU (InventoryTrackingMethod=SKU) needs a different fix — skip.
  if (/tracked by sku|inventorytrackingmethod/i.test(reason)) return false;
  if (/sku/i.test(reason)) return true;
  // A bare 400 / "no details" migrate failure is most commonly a missing SKU.
  return /http 400|bad request|migration_failed|migration_missing_sku|no error details|no_response|2571[08]/i.test(
    reason
  );
}

/** Auctions / non-GTC / classified-ad listings can never be migrated; SKU won't help. */
function migrationErrorNonRemediable(reason: string): boolean {
  return /auction|classified|listingtype|not a fixed|non-fixed|good 'til|\bgtc\b|duration/i.test(reason);
}

function buildReviseSkuXml(listingId: string, sku: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <Item>
    <ItemID>${listingId}</ItemID>
    <SKU>${sku}</SKU>
  </Item>
</ReviseFixedPriceItemRequest>`;
}

/** Trading API returns HTTP 200 with <Ack>Failure</Ack> + <Errors> for logical failures. */
function parseTradingAck(xml: string): { ok: boolean; error?: string } {
  const ack = (tag(xml, "Ack") ?? "").trim();
  if (/success|warning/i.test(ack)) return { ok: true };
  const errors = tag(xml, "Errors") ?? "";
  const msg = (tag(errors, "LongMessage") ?? tag(errors, "ShortMessage") ?? "ReviseFixedPriceItem failed").trim();
  return { ok: false, error: msg };
}

/** Add a seller-defined SKU (Custom Label) to a live fixed-price listing. */
async function setEbayListingSku(
  accessToken: string,
  listingId: string,
  sku: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const xml = await callTrading(accessToken, "ReviseFixedPriceItem", buildReviseSkuXml(listingId, sku));
    return parseTradingAck(xml);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fetch the SKU from an already-migrated listing via GetItem.
 * When migration returns 409 (already migrated), the listing has a SKU we can use.
 */
async function fetchExistingListingSku(
  accessToken: string,
  listingId: string
): Promise<string | null> {
  try {
    const xml = await callTrading(accessToken, "GetItem", buildGetItemXml(listingId));
    const item = tag(xml, "Item") ?? xml;
    const sku = tag(item, "SKU");
    if (sku) {
      console.log("[ebay] fetchExistingListingSku: found SKU", { listingId, sku });
      return sku.trim();
    }
    console.warn("[ebay] fetchExistingListingSku: no SKU in listing", { listingId });
    return null;
  } catch (e) {
    console.error("[ebay] fetchExistingListingSku failed", {
      listingId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * For listings that returned 409 (already migrated), look up the existing SKU.
 * Mutates `result` in place.
 */
async function resolveAlreadyMigratedSkus(
  accessToken: string,
  result: Map<string, MigrationResult>
): Promise<void> {
  for (const [listingId, res] of result) {
    if (res.error !== "already_migrated_needs_sku_lookup") continue;
    
    const sku = await fetchExistingListingSku(accessToken, listingId);
    if (sku) {
      result.set(listingId, { sku });
      console.log("[ebay] resolved already-migrated listing", { listingId, sku });
    } else {
      // Try using our standard SKU format as fallback
      const fallbackSku = generateMigrationSku(listingId);
      console.log("[ebay] using fallback SKU for already-migrated listing", { listingId, fallbackSku });
      result.set(listingId, { sku: fallbackSku });
    }
  }
}

/**
 * For listings that failed migration because they lack a SKU, add one via
 * ReviseFixedPriceItem and retry the migration. Mutates `result` in place.
 */
async function remediateMissingSkus(
  accessToken: string,
  result: Map<string, MigrationResult>
): Promise<void> {
  for (const [listingId, res] of result) {
    if (!res.error || res.sku) continue;
    if (!/^\d+$/.test(listingId)) continue;
    if (!migrationErrorLikelyMissingSku(res.error) || migrationErrorNonRemediable(res.error)) continue;

    const set = await setEbayListingSku(accessToken, listingId, generateMigrationSku(listingId));
    if (!set.ok) {
      if (set.error && /fixed price|fixed-price|auction|not.*fixed/i.test(set.error)) {
        result.set(listingId, {
          error:
            "not_fixed_price — eBay can only sync fixed-price (Buy It Now) listings. Auctions and classified ads can't be synced.",
        });
      }
      // Otherwise keep the original migration error.
      continue;
    }

    try {
      const retry = await migrateListingBatch(accessToken, [listingId]);
      const retryMap = new Map<string, MigrationResult>();
      applyMigrateResponse(retryMap, retry, [listingId]);
      const r = retryMap.get(listingId);
      if (r) result.set(listingId, r);
    } catch (e) {
      result.set(listingId, { error: formatMigrationError(e) });
    }
  }
}

function applyMigrateResponse(
  result: Map<string, MigrationResult>,
  res: MigrateResponse,
  batch: string[]
): void {
  for (const r of res.responses ?? []) {
    if (!r.listingId) continue;
    const ok = r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300;
    
    // Handle 409 Conflict - listing was already migrated
    // Mark it for SKU lookup rather than treating as error
    if (r.statusCode === 409) {
      result.set(r.listingId, { error: "already_migrated_needs_sku_lookup" });
      continue;
    }
    
    if (!ok) {
      result.set(r.listingId, { error: formatMigrateListingError(r) });
      continue;
    }
    const sku = r.inventoryItems?.[0]?.sku;
    if (!sku) {
      result.set(r.listingId, { error: "migration_missing_sku" });
      continue;
    }
    result.set(r.listingId, {
      sku,
      offerId: r.offers?.[0]?.offerId ?? r.inventoryItems?.[0]?.offerId,
    });
  }
  for (const id of batch) {
    if (!result.has(id)) result.set(id, { error: "no_response" });
  }
}

async function migrateListingBatch(
  accessToken: string,
  listingIds: string[]
): Promise<MigrateResponse> {
  const validIds = listingIds.filter((id) => /^\d+$/.test(id.trim()));
  if (validIds.length === 0) {
    throw new Error("Invalid eBay listing id — expected a numeric Item ID from your active listings.");
  }
  const payload = { requests: validIds.map((listingId) => ({ listingId: listingId.trim() })) };
  try {
    return await ebayJson<MigrateResponse>(
      accessToken,
      "/sell/inventory/v1/bulk_migrate_listing",
      "POST",
      payload
    );
  } catch (e) {
    // eBay sometimes returns HTTP 400/500 with a bulk `responses` array instead of top-level `errors`.
    if (e instanceof EbayApiError) {
      const bulk = extractBulkMigrateResponse(e.body);
      if (bulk) {
        console.warn("[ebay] bulk_migrate_listing returned non-2xx with per-listing responses", {
          httpStatus: e.status,
          listingIds: validIds,
        });
        return bulk;
      }
      console.error("[ebay] bulk_migrate_listing failed", {
        httpStatus: e.status,
        listingIds: validIds,
        body: e.body,
      });
    }
    throw e;
  }
}

/**
 * Bring classic listings under the Inventory model so unified inventory updates work.
 * Returns a map listingId -> { sku, offerId } (or an error reason).
 */
export async function migrateEbayListings(
  accessToken: string,
  listingIds: string[]
): Promise<Map<string, MigrationResult>> {
  const result = new Map<string, MigrationResult>();
  // The Inventory API `getOffers` endpoint cannot look up offers by listingId (it requires
  // a SKU and only sees Inventory-API-created offers), so we attempt migration directly.
  const pending: string[] = [...listingIds];

  // bulk_migrate_listing accepts up to 5 listings per call and is known to be flaky (HTTP 500).
  for (let i = 0; i < pending.length; i += 5) {
    const batch = pending.slice(i, i + 5);
    try {
      const res = await migrateListingBatch(accessToken, batch);
      applyMigrateResponse(result, res, batch);
      continue;
    } catch (batchErr) {
      console.warn("[ebay] bulk_migrate_listing batch failed; retrying one-by-one", {
        batch,
        error: formatMigrationError(batchErr),
      });
    }

    for (const listingId of batch) {
      if (result.has(listingId)) continue;
      try {
        const res = await migrateListingBatch(accessToken, [listingId]);
        applyMigrateResponse(result, res, [listingId]);
      } catch (singleErr) {
        result.set(listingId, { error: formatMigrationError(singleErr) });
      }
    }
  }

  // Listings that returned 409 (already migrated): look up their existing SKU.
  await resolveAlreadyMigratedSkus(accessToken, result);

  // Listings that failed because they lack a SKU: add one via ReviseFixedPriceItem and retry.
  // This is eBay's documented remediation and unblocks website-created listings.
  await remediateMissingSkus(accessToken, result);

  return result;
}

/**
 * Subscribe to eBay Platform Notifications for item changes.
 * This enables real-time sync when listings are edited on eBay.
 *
 * Events subscribed:
 * - ItemRevised: Listing was edited
 * - ItemClosed: Listing ended
 * - ItemSold: Full sale (quantity reached 0)
 * - FixedPriceTransaction: Partial sale (quantity decremented)
 */
export async function subscribeToEbayNotifications(
  accessToken: string,
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<SetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ApplicationDeliveryPreferences>
    <ApplicationEnable>Enable</ApplicationEnable>
    <ApplicationURL>${escapeXml(webhookUrl)}</ApplicationURL>
    <DeviceType>Platform</DeviceType>
  </ApplicationDeliveryPreferences>
  <UserDeliveryPreferenceArray>
    <NotificationEnable>
      <EventType>ItemRevised</EventType>
      <EventEnable>Enable</EventEnable>
    </NotificationEnable>
    <NotificationEnable>
      <EventType>ItemClosed</EventType>
      <EventEnable>Enable</EventEnable>
    </NotificationEnable>
    <NotificationEnable>
      <EventType>ItemSold</EventType>
      <EventEnable>Enable</EventEnable>
    </NotificationEnable>
    <NotificationEnable>
      <EventType>FixedPriceTransaction</EventType>
      <EventEnable>Enable</EventEnable>
    </NotificationEnable>
  </UserDeliveryPreferenceArray>
</SetNotificationPreferencesRequest>`;

  try {
    const response = await callTrading(accessToken, "SetNotificationPreferences", xml);

    // Check for success
    const ack = tag(response, "Ack");
    if (ack === "Success" || ack === "Warning") {
      console.log("[ebay] subscribeToEbayNotifications: success", { webhookUrl });
      return { success: true };
    }

    // Extract error message
    const errorMsg = tag(response, "LongMessage") || tag(response, "ShortMessage") || "Unknown error";
    console.error("[ebay] subscribeToEbayNotifications: failed", { ack, errorMsg });
    return { success: false, error: errorMsg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ebay] subscribeToEbayNotifications: exception", { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Check current notification subscription status.
 */
export async function getEbayNotificationPreferences(
  accessToken: string
): Promise<{ subscribed: boolean; webhookUrl?: string; events?: string[] }> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <PreferenceLevel>Application</PreferenceLevel>
</GetNotificationPreferencesRequest>`;

  try {
    const response = await callTrading(accessToken, "GetNotificationPreferences", xml);
    const ack = tag(response, "Ack");

    if (ack !== "Success" && ack !== "Warning") {
      return { subscribed: false };
    }

    const appPrefs = tag(response, "ApplicationDeliveryPreferences");
    const appEnabled = appPrefs ? tag(appPrefs, "ApplicationEnable") : null;
    const appUrl = appPrefs ? tag(appPrefs, "ApplicationURL") : null;

    // Extract enabled events
    const enabledEvents: string[] = [];
    const notifications = allTags(response, "NotificationEnable");
    for (const n of notifications) {
      const eventType = tag(n, "EventType");
      const eventEnable = tag(n, "EventEnable");
      if (eventType && eventEnable === "Enable") {
        enabledEvents.push(eventType);
      }
    }

    return {
      subscribed: appEnabled === "Enable" && !!appUrl,
      webhookUrl: appUrl || undefined,
      events: enabledEvents,
    };
  } catch (e) {
    console.error("[ebay] getEbayNotificationPreferences: exception", { error: e });
    return { subscribed: false };
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
