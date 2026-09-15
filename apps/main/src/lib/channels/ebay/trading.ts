import {
  EBAY_API_BASE,
  EBAY_NO_STORE_FETCH,
  EBAY_TRADING_COMPAT_LEVEL,
  EBAY_TRADING_SITE_ID,
} from "./config";
import { ebayJson } from "./client";
import { paceEbayCall } from "./rate-context";
import { EbayApiError } from "./errors";
import { describeEbayThrownError, extractBulkMigrateResponse, formatMigrateListingError } from "./errors";
import { allTags, extractEbayItemPhotos, extractEbayItemPhotosForInventoryPut, tag } from "./photos";
import {
  parseEbayBestOffer,
  parseEbayCondition,
  parseEbayConditionEnum,
  parseEbayDescription,
  parseEbayItemSpecifics,
  parseEbayLastModified,
  parseEbayPrimaryCategory,
  parseEbayVariations,
  ebayGetItemTradingQuantity,
} from "./item-specifics";
import type { ListingAspect } from "@/lib/listing-limits";
import { getEbayCategoryPathFromId } from "./category-path";
import { resolveEbayLegacyListingId } from "./mapping";
import { ebayWebhookUrlIsSecured, redactEbayWebhookUrl } from "./webhook";
import {
  canSkipEbayBulkMigrate,
  classifyEbayItemForMigration,
  ENDED_LISTING_MIGRATE_ERROR,
  generateEbayMigrationSku,
  isValidEbayInventorySku,
  listingHasValidMigrateSku,
  NOT_FIXED_PRICE_MIGRATE_ERROR,
} from "./migrate-prep";

/** A classic (Trading API) eBay listing enumerated for import preview. */
export type EbayTradingListing = {
  listingId: string;
  title: string;
  priceCents: number;
  /** View Item / QuantityAvailable remaining. */
  quantity: number;
  /** Seller Hub listed remaining (Quantity − sold). Null when the list omitted Quantity. */
  tradingQuantity?: number | null;
  photos: string[];
  /** eBay leaf category id (from PrimaryCategory) when known. */
  remoteCategoryId?: string | null;
  categoryName?: string | null;
  remoteUpdatedAt?: Date | null;
  condition?: "new" | "used" | null;
  /** Seller-defined SKU (Custom Label) when set. Used for INW-migrated listings. */
  sku?: string | null;
  /** Business-policy fulfillment / shipping profile id when the listing uses one. */
  remoteShippingProfileId?: string | null;
};

/** Shipping business policy on a Trading API Item (GetMyeBaySelling / GetItem). */
export function parseEbaySellerShippingProfile(itemXml: string): {
  remoteProfileId: string | null;
  name: string | null;
} {
  const profiles = tag(itemXml, "SellerProfiles") ?? "";
  const shipping = tag(profiles, "SellerShippingProfile") ?? tag(itemXml, "SellerShippingProfile") ?? "";
  const id = tag(shipping, "ShippingProfileID")?.trim() || null;
  const name = tag(shipping, "ShippingProfileName")?.trim() || null;
  return { remoteProfileId: id, name };
}

/** Full item specifics + description + photos for a listing (fetched on import, not preview). */
export type EbayItemDetails = {
  aspects: ListingAspect[];
  remoteCategoryId: string | null;
  categoryName: string | null;
  description: string | null;
  /** All photos from GetItem (gallery + PictureDetails), display-sized for INW. */
  photos: string[];
  /** GetItem pictures safe to echo on Inventory PUT (no EPS→CDN rewrite). */
  inventoryPinPhotos: string[];
  title: string | null;
  condition: "new" | "used" | null;
  conditionEnum: string | null;
  remoteUpdatedAt: Date | null;
  quantity: number | null;
  /**
   * Seller Hub listed remaining (Quantity − QuantitySold) when it diverges from
   * QuantityAvailable. Catch-up copies Hub remaining onto the live offer so View
   * Item updates; outbound skips while a catch-up retry is pending.
   */
  tradingQuantity: number | null;
  priceCents: number | null;
  variants: unknown;
  /** GetItem variation qtys from listed remaining — catch-up Trading surface. */
  tradingVariants: unknown;
  /** Listing-level Custom Label from GetItem `<SKU>` (simple listings). */
  sku: string | null;
  listingEnded: boolean;
  /** Units sold on this listing (SellingStatus.QuantitySold). */
  quantitySold: number;
  acceptOffers: boolean;
  minOfferCents: number | null;
  remoteShippingProfileId: string | null;
};

/** Parse GetMyeBaySelling ActiveList qty the same way as GetItem (listed remaining vs available). */
export function parseEbaySellerListAvailability(itemXml: string): {
  quantity: number;
  tradingQuantity: number | null;
} {
  const sellingStatus = tag(itemXml, "SellingStatus") ?? "";
  const quantitySold = Math.max(0, Number(tag(sellingStatus, "QuantitySold") ?? "0") || 0);
  const availableStr = tag(itemXml, "QuantityAvailable");
  const listedStr = tag(itemXml, "Quantity") ?? "";
  let listed: number | null = null;
  if (listedStr !== "") {
    const n = Number(listedStr);
    if (Number.isFinite(n)) listed = Math.max(0, Math.round(n));
  }
  let quantity = 0;
  if (availableStr != null && availableStr !== "") {
    quantity = Math.max(0, Number(availableStr) || 0);
  } else if (listed != null) {
    quantity = Math.max(0, listed - quantitySold);
  }
  return {
    quantity,
    tradingQuantity: ebayGetItemTradingQuantity({
      listed,
      available: quantity,
      sold: quantitySold,
    }),
  };
}

/** Seller Hub listed remaining — prefer over QuantityAvailable (View Item / live offer). */
export function ebaySellerHubListedQuantity(details: {
  tradingQuantity?: number | null;
  quantity?: number | null;
}): number | null {
  if (details.tradingQuantity != null && Number.isFinite(details.tradingQuantity)) {
    return Math.max(0, Math.round(details.tradingQuantity));
  }
  if (details.quantity != null && Number.isFinite(details.quantity)) {
    return Math.max(0, Math.round(details.quantity));
  }
  return null;
}

/** True when Seller Hub listed remaining disagrees with View Item / available qty. */
export function ebaySellerHubQtyAheadOfViewItem(details: {
  tradingQuantity?: number | null;
  quantity?: number | null;
}): boolean {
  const hub = ebaySellerHubListedQuantity(details);
  if (hub == null || details.quantity == null || !Number.isFinite(details.quantity)) return false;
  return hub !== Math.max(0, Math.round(details.quantity));
}

/**
 * GetItem/Trading echoes our own push for a short window. Outside it, a Trading-only
 * quantity is the seller's Seller Hub revise, not our lag.
 */
export const EBAY_TRADING_PUSH_ECHO_MS = 2 * 60_000;

export function ebayInwPushedRecently(
  lastPushedAt: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastPushedAt) return false;
  return now.getTime() - lastPushedAt.getTime() < EBAY_TRADING_PUSH_ECHO_MS;
}

/**
 * Listing-level stock from GetItem. Strips Variations so a size with qty 0 cannot
 * be read as the whole listing being sold out.
 */
export function parseEbayGetItemAvailability(itemXml: string): {
  quantity: number | null;
  tradingQuantity: number | null;
  quantitySold: number;
  listingEnded: boolean;
} {
  const listingXml = itemXml
    .replace(/<Description[\s\S]*?<\/Description>/gi, "")
    .replace(/<Variations[\s\S]*?<\/Variations>/gi, "");
  const sellingStatus = tag(listingXml, "SellingStatus") ?? "";
  // Only SellingStatus.ListingStatus. A fallback scan of the whole Item XML can
  // pick up "Ended" / "Completed" inside the HTML description and false-delete.
  const listingStatus = (tag(sellingStatus, "ListingStatus") ?? "").toLowerCase();
  const quantitySold = Math.max(0, Number(tag(sellingStatus, "QuantitySold") ?? "0") || 0);
  const availableStr = tag(listingXml, "QuantityAvailable");
  const listedStr = tag(listingXml, "Quantity") ?? "";
  let listed: number | null = null;
  if (listedStr !== "") {
    const n = Number(listedStr);
    if (Number.isFinite(n)) listed = Math.max(0, Math.round(n));
  }
  let quantity: number | null = null;
  if (availableStr != null && availableStr !== "") {
    quantity = Math.max(0, Number(availableStr) || 0);
  } else if (listed != null) {
    quantity = Math.max(0, listed - quantitySold);
  }
  return {
    quantity,
    tradingQuantity: ebayGetItemTradingQuantity({
      listed,
      available: quantity,
      sold: quantitySold,
    }),
    quantitySold,
    listingEnded: listingStatus === "completed" || listingStatus === "ended",
  };
}

/** Seller ended / expired with no units sold — do not move INW to the Sold tab. */
export function ebayGetItemMarksInwSoldOut(details: {
  listingEnded: boolean;
  quantitySold: number;
  quantity: number | null;
}): boolean {
  if (!details.listingEnded) return false;
  if (details.quantitySold <= 0) return false;
  if (details.quantity != null && details.quantity > 0) return false;
  return true;
}

/** Active listing reporting 0 available with no QuantitySold — likely a bad parse, not a sale. */
export function ebayGetItemQtyIsUnsoldZero(details: {
  listingEnded: boolean;
  quantitySold: number;
  quantity: number | null;
}): boolean {
  return details.quantity === 0 && details.quantitySold <= 0 && !details.listingEnded;
}

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
  // Pace GetItem/GetMyeBaySelling against the bound connection's eBay rate window.
  await paceEbayCall();
  const res = await fetch(TRADING_ENDPOINT, {
    ...EBAY_NO_STORE_FETCH,
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
    throw new EbayApiError(
      `eBay Trading ${callName} failed (${res.status}).`,
      res.status,
      text,
      callName
    );
  }
  const ack = parseTradingAck(text);
  if (!ack.ok) {
    const msg = ack.error ?? `eBay Trading ${callName} failed`;
    const authLike = /auth|token|expired|invalid/i.test(msg);
    throw new EbayApiError(msg, authLike ? 401 : 400, text, callName);
  }
  return text;
}

function buildEndItemXml(listingId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${listingId}</ItemID>
  <EndingReason>NotAvailable</EndingReason>
</EndItemRequest>`;
}

/** True when EndItem failed because the listing is already off the site. */
export function isEbayTradingListingAlreadyEnded(message: string): boolean {
  return /1047|17\b|already been closed|already ended|has ended|listing has been deleted|item cannot be accessed|does not exist|this item cannot be accessed/i.test(
    message
  );
}

/** End a live eBay listing via Trading API. Already-ended listings count as success. */
export async function endEbayTradingItem(accessToken: string, listingId: string): Promise<void> {
  try {
    await callTrading(accessToken, "EndItem", buildEndItemXml(listingId));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isEbayTradingListingAlreadyEnded(msg)) return;
    throw e;
  }
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
  const legacy = resolveEbayLegacyListingId(listingId);
  if (!legacy) {
    throw new Error(`GetItem requires an eBay Item ID (got ${listingId})`);
  }
  try {
    const xml = await callTrading(accessToken, "GetItem", buildGetItemXml(legacy));
    
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
      xmlLength: xml.length,
      hasPictureDetails: item.includes("<PictureDetails>"),
      hasPictureURL: item.includes("<PictureURL>"),
      hasItemSpecifics: item.includes("<ItemSpecifics>"),
      hasNameValueList: item.includes("<NameValueList>"),
      hasPrimaryCategory: item.includes("<PrimaryCategory>"),
      hasLastModifiedTimeXml: /LastModifiedTime/i.test(xml),
      hasLastModifiedTimeItem: /LastModifiedTime/i.test(item),
      timeTagNames: [
        ...new Set(
          [...xml.matchAll(/<([A-Za-z0-9_:]*Time)\b/g)].map((m) => m[1])
        ),
      ],
    });
    
    const { categoryId, categoryName } = parseEbayPrimaryCategory(item);
    const resolvedCategoryPath = categoryId
      ? await getEbayCategoryPathFromId(categoryId, categoryName)
      : categoryName;
    const aspects = parseEbayItemSpecifics(item);
    const photos = extractEbayItemPhotos(item);
    const inventoryPinPhotos = extractEbayItemPhotosForInventoryPut(item);

    // Debug logging for import issues
    const gradeRelatedAspects = aspects.filter((a) =>
      /grade|grader|certification|professional/i.test(a.name)
    );
    console.log("[ebay] fetchEbayItemDetails parsed result", {
      listingId,
      aspectsCount: aspects.length,
      photosCount: photos.length,
      categoryId,
      categoryName: resolvedCategoryPath,
      hasDescription: !!parseEbayDescription(item),
      firstAspect: aspects[0] || null,
      firstPhoto: photos[0]?.slice(0, 80) || null,
      allAspectNames: aspects.map((a) => a.name),
      gradeRelatedAspects,
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

    const sellingStatus = tag(item, "SellingStatus") ?? "";
    const availability = parseEbayGetItemAvailability(item);
    const priceStr =
      tag(sellingStatus, "CurrentPrice") ?? tag(item, "StartPrice") ?? tag(item, "CurrentPrice") ?? "";
    const priceCents = priceStr !== "" ? Math.round((Number(priceStr) || 0) * 100) : null;
    const titleRaw = tag(item, "Title");
    const bestOffer = parseEbayBestOffer(item);

    return {
      aspects,
      remoteCategoryId: categoryId,
      categoryName: resolvedCategoryPath,
      description: parseEbayDescription(item),
      photos,
      inventoryPinPhotos,
      title: titleRaw ? decodeXmlTitle(titleRaw) : null,
      condition: parseEbayCondition(item),
      conditionEnum: parseEbayConditionEnum(item),
      remoteUpdatedAt: parseEbayLastModified(item) ?? parseEbayLastModified(xml),
      quantity: availability.quantity,
      tradingQuantity: availability.tradingQuantity,
      quantitySold: availability.quantitySold,
      priceCents,
      variants: parseEbayVariations(item),
      tradingVariants: parseEbayVariations(item, { quantityMode: "trading" }),
      sku: tag(item, "SKU")?.trim() || null,
      listingEnded: availability.listingEnded,
      acceptOffers: bestOffer.acceptOffers,
      minOfferCents: bestOffer.minOfferCents,
      remoteShippingProfileId: parseEbaySellerShippingProfile(item).remoteProfileId,
    };
  } catch (e) {
    console.error("[ebay] fetchEbayItemDetails failed", {
      listingId,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

function decodeXmlTitle(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
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
export async function enumerateEbayListings(
  accessToken: string,
  opts?: { skipPhotoEnrichment?: boolean }
): Promise<EbayTradingListing[]> {
  const out: EbayTradingListing[] = [];
  for (let page = 1; page <= 20; page += 1) {
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
      const availability = parseEbaySellerListAvailability(item);
      const quantity = availability.quantity;
      const photos = extractEbayItemPhotos(item);
      const { categoryId, categoryName } = parseEbayPrimaryCategory(item);
      const sku = tag(item, "SKU")?.trim() || null;
      out.push({
        listingId,
        title,
        priceCents,
        quantity,
        tradingQuantity: availability.tradingQuantity,
        photos,
        remoteCategoryId: categoryId,
        categoryName,
        remoteUpdatedAt: parseEbayLastModified(item),
        condition: parseEbayCondition(item),
        sku,
        remoteShippingProfileId: parseEbaySellerShippingProfile(item).remoteProfileId,
      });
    }
    // Stop early if this page was not full (no further pages).
    if (items.length < 100) break;
  }
  if (!opts?.skipPhotoEnrichment) {
    await enrichPhotosViaGetItem(accessToken, out);
  }
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

export { generateEbayMigrationSku, isValidEbayInventorySku } from "./migrate-prep";

/** Trading API returns HTTP 200 with <Ack>Failure</Ack> + <Errors> for logical failures. */
function parseTradingAck(xml: string): { ok: boolean; error?: string; errorCode?: string } {
  const ack = (tag(xml, "Ack") ?? "").trim();
  if (/success|warning/i.test(ack)) return { ok: true };
  const errors = tag(xml, "Errors") ?? "";
  const msg = (tag(errors, "LongMessage") ?? tag(errors, "ShortMessage") ?? "Trading call failed").trim();
  const errorCode = (tag(errors, "ErrorCode") ?? "").trim() || undefined;
  return { ok: false, error: errorCode ? `${msg} (${errorCode})` : msg, errorCode };
}

function formatMigrationError(e: unknown): string {
  return describeEbayThrownError(e);
}

function generateMigrationSku(listingId: string): string {
  return generateEbayMigrationSku(listingId);
}

async function fetchItemXml(accessToken: string, listingId: string): Promise<string> {
  const xml = await callTrading(accessToken, "GetItem", buildGetItemXml(listingId));
  return tag(xml, "Item") ?? xml;
}

/**
 * Confirm a valid Inventory SKU is on the live listing before bulk_migrate_listing.
 * Never migrates a listing whose Custom Label is still empty.
 */
async function ensureListingSkuOnEbay(
  accessToken: string,
  listingId: string
): Promise<{ sku?: string; error?: string }> {
  let itemXml: string;
  try {
    itemXml = await fetchItemXml(accessToken, listingId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  let cls = classifyEbayItemForMigration(itemXml);
  if (cls.kind === "not_fixed_price") return { error: NOT_FIXED_PRICE_MIGRATE_ERROR };
  if (cls.kind === "ended") return { error: ENDED_LISTING_MIGRATE_ERROR };

  if (listingHasValidMigrateSku(cls)) {
    return { sku: cls.itemSku ?? generateMigrationSku(listingId) };
  }

  return {
    error:
      "This listing has no Custom Label (SKU). INW does not rewrite eBay SKUs; add one in Seller Hub if you need Inventory API migrate.",
  };
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
      const trimmed = sku.trim();
      const valid = isValidEbayInventorySku(trimmed);
      if (!valid) {
        console.warn("[ebay] fetchExistingListingSku: live Custom Label is not a valid Inventory SKU", {
          listingId,
          sku: trimmed,
        });
        return null;
      }
      console.log("[ebay] fetchExistingListingSku: found SKU", { listingId, sku: trimmed });
      return trimmed;
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
      const err = formatMigrateListingError(r);
      result.set(r.listingId, { error: err });
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

function isEbayMigrateTimeout(e: unknown): boolean {
  if (e instanceof EbayApiError && e.status === 504) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /timed out after \d+s/i.test(msg);
}

/**
 * Confirm a valid Inventory SKU on every listing before migrate. Listings that
 * cannot be stamped are skipped with the Trading error — not Inventory #25002.
 */
async function ensureSkusBeforeMigrate(
  accessToken: string,
  listingIds: string[],
  result: Map<string, MigrationResult>
): Promise<string[]> {
  const ready: string[] = [];
  for (const listingId of listingIds) {
    const ensured = await ensureListingSkuOnEbay(accessToken, listingId);
    if (ensured.error) {
      console.warn("[ebay] skip migrate; listing has no confirmed SKU", {
        listingId,
        error: ensured.error,
      });
      result.set(listingId, { error: ensured.error });
      continue;
    }
    ready.push(listingId);
  }
  return ready;
}

/**
 * Client abort / eBay 504 often means migrate is still running. Look up SKU first,
 * then retry that listing once if it was never migrated.
 */
async function recoverTimedOutMigrateBatch(
  accessToken: string,
  batch: string[],
  result: Map<string, MigrationResult>
): Promise<void> {
  for (const listingId of batch) {
    const current = result.get(listingId);
    if (current?.sku) continue;
    const existing = await fetchExistingListingSku(accessToken, listingId);
    if (existing && isValidEbayInventorySku(existing)) {
      result.set(listingId, { sku: existing });
      console.log("[ebay] recovered timed-out migrate via existing SKU", { listingId, sku: existing });
      continue;
    }
    try {
      const res = await migrateListingBatch(accessToken, [listingId]);
      applyMigrateResponse(result, res, [listingId]);
    } catch (e) {
      if (isEbayMigrateTimeout(e)) {
        const again = await fetchExistingListingSku(accessToken, listingId);
        if (again) {
          result.set(listingId, { sku: again });
          console.log("[ebay] recovered timed-out migrate retry via SKU", { listingId, sku: again });
        } else {
          result.set(listingId, { error: formatMigrationError(e) });
        }
        continue;
      }
      if (e instanceof EbayApiError) {
        const bulk = extractBulkMigrateResponse(e.body);
        if (bulk) {
          applyMigrateResponse(result, bulk, [listingId]);
          continue;
        }
      }
      result.set(listingId, { error: formatMigrationError(e) });
    }
  }
}

/**
 * Bring classic listings under the Inventory model so unified inventory updates work.
 * Returns a map listingId -> { sku, offerId } (or an error reason).
 */
function knownSkuForListing(
  listingId: string,
  knownSkus?: Map<string, string | null | undefined>
): string | null | undefined {
  if (!knownSkus) return undefined;
  if (knownSkus.has(listingId)) return knownSkus.get(listingId);
  const legacy = resolveEbayLegacyListingId(listingId);
  if (legacy && knownSkus.has(legacy)) return knownSkus.get(legacy);
  return undefined;
}

function skuForSkippedMigrate(listingId: string, knownSku?: string | null): string | null {
  const known = knownSku?.trim();
  if (known) return known;
  const id = listingId.trim();
  return id || null;
}

export async function migrateEbayListings(
  accessToken: string,
  listingIds: string[],
  opts?: { knownSkus?: Map<string, string | null | undefined> }
): Promise<Map<string, MigrationResult>> {
  const result = new Map<string, MigrationResult>();
  // The Inventory API `getOffers` endpoint cannot look up offers by listingId (it requires
  // a SKU and only sees Inventory-API-created offers), so we attempt migration directly.
  const pending: string[] = [];
  for (const raw of listingIds) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const legacy = resolveEbayLegacyListingId(trimmed) ?? (/^\d+$/.test(trimmed) ? trimmed : null);
    const known = knownSkuForListing(trimmed, opts?.knownSkus) ?? knownSkuForListing(legacy ?? "", opts?.knownSkus);
    const migrateId = legacy ?? trimmed;
    if (canSkipEbayBulkMigrate(migrateId, known ?? (!/^\d+$/.test(trimmed) ? trimmed : null))) {
      const sku = skuForSkippedMigrate(migrateId, known ?? (!/^\d+$/.test(trimmed) ? trimmed : null));
      if (sku) {
        result.set(migrateId, { sku });
        if (trimmed !== migrateId) result.set(trimmed, { sku });
        continue;
      }
    }
    if (!legacy) {
      result.set(trimmed, {
        error: "Invalid eBay listing id — expected a numeric Item ID from your active listings.",
      });
      continue;
    }
    if (!pending.includes(legacy)) pending.push(legacy);
  }

  const toMigrate = await ensureSkusBeforeMigrate(accessToken, pending, result);

  // bulk_migrate_listing accepts up to 5 listings per call and is known to be flaky (HTTP 500).
  for (let i = 0; i < toMigrate.length; i += 5) {
    const batch = toMigrate.slice(i, i + 5);
    try {
      const res = await migrateListingBatch(accessToken, batch);
      applyMigrateResponse(result, res, batch);
      continue;
    } catch (batchErr) {
      if (isEbayMigrateTimeout(batchErr)) {
        console.warn("[ebay] bulk_migrate_listing timed out; recovering via SKU lookup", {
          batch,
          error: formatMigrationError(batchErr),
        });
        await recoverTimedOutMigrateBatch(accessToken, batch, result);
        continue;
      }
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
        if (isEbayMigrateTimeout(singleErr)) {
          await recoverTimedOutMigrateBatch(accessToken, [listingId], result);
          continue;
        }
        result.set(listingId, { error: formatMigrationError(singleErr) });
      }
    }
  }

  // Listings that returned 409 (already migrated): look up their existing SKU.
  await resolveAlreadyMigratedSkus(accessToken, result);

  return result;
}

/**
 * Subscribe to eBay Platform Notifications for item changes.
 *
 * ItemRevised HTTP handler is ack-only (no GetItem on the webhook request).
 * A delayed job copies Hub listed remaining / StartPrice onto the live offer.
 */
export function buildSubscribeEbayNotificationsXml(webhookUrl: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
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
}

export async function subscribeToEbayNotifications(
  accessToken: string,
  webhookUrl: string
): Promise<{ success: boolean; error?: string }> {
  const xml = buildSubscribeEbayNotificationsXml(webhookUrl);

  try {
    const response = await callTrading(accessToken, "SetNotificationPreferences", xml);

    // Check for success
    const ack = tag(response, "Ack");
    if (ack === "Success" || ack === "Warning") {
      console.log("[ebay] subscribeToEbayNotifications: success", {
        webhookUrl: redactEbayWebhookUrl(webhookUrl),
      });
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

export function buildUnsubscribeEbayNotificationsXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<SetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ApplicationDeliveryPreferences>
    <ApplicationEnable>Disable</ApplicationEnable>
    <DeviceType>Platform</DeviceType>
  </ApplicationDeliveryPreferences>
  <UserDeliveryPreferenceArray>
    <NotificationEnable>
      <EventType>ItemRevised</EventType>
      <EventEnable>Disable</EventEnable>
    </NotificationEnable>
    <NotificationEnable>
      <EventType>ItemClosed</EventType>
      <EventEnable>Disable</EventEnable>
    </NotificationEnable>
    <NotificationEnable>
      <EventType>ItemSold</EventType>
      <EventEnable>Disable</EventEnable>
    </NotificationEnable>
    <NotificationEnable>
      <EventType>FixedPriceTransaction</EventType>
      <EventEnable>Disable</EventEnable>
    </NotificationEnable>
  </UserDeliveryPreferenceArray>
</SetNotificationPreferencesRequest>`;
}

/** Stop eBay Platform Notifications from posting to INW after disconnect. */
export async function unsubscribeFromEbayNotifications(
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await callTrading(
      accessToken,
      "SetNotificationPreferences",
      buildUnsubscribeEbayNotificationsXml()
    );
    const ack = tag(response, "Ack");
    if (ack === "Success" || ack === "Warning") {
      console.log("[ebay] unsubscribeFromEbayNotifications: success");
      return { success: true };
    }
    const errorMsg = tag(response, "LongMessage") || tag(response, "ShortMessage") || "Unknown error";
    console.error("[ebay] unsubscribeFromEbayNotifications: failed", { ack, errorMsg });
    return { success: false, error: errorMsg };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ebay] unsubscribeFromEbayNotifications: exception", { error: msg });
    return { success: false, error: msg };
  }
}

async function fetchEbayNotificationPreferenceLevel(
  accessToken: string,
  level: "Application" | "User"
): Promise<string | null> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <PreferenceLevel>${level}</PreferenceLevel>
</GetNotificationPreferencesRequest>`;
  const response = await callTrading(accessToken, "GetNotificationPreferences", xml);
  const ack = tag(response, "Ack");
  if (ack !== "Success" && ack !== "Warning") return null;
  return response;
}

function enabledNotificationEvents(xml: string): string[] {
  const enabledEvents: string[] = [];
  for (const n of allTags(xml, "NotificationEnable")) {
    const eventType = tag(n, "EventType");
    const eventEnable = tag(n, "EventEnable");
    if (eventType && eventEnable === "Enable") enabledEvents.push(eventType);
  }
  return enabledEvents;
}

/**
 * Check current notification subscription status (Application URL + User events).
 */
export async function getEbayNotificationPreferences(
  accessToken: string
): Promise<{
  fetched: boolean;
  subscribed: boolean;
  webhookUrl?: string;
  urlSecured?: boolean;
  events?: string[];
}> {
  try {
    const appXml = await fetchEbayNotificationPreferenceLevel(accessToken, "Application");
    if (!appXml) return { fetched: false, subscribed: false };

    const appPrefs = tag(appXml, "ApplicationDeliveryPreferences");
    const appEnabled = appPrefs ? tag(appPrefs, "ApplicationEnable") : null;
    const appUrl = appPrefs ? tag(appPrefs, "ApplicationURL") : null;

    const events = enabledNotificationEvents(appXml);
    try {
      const userXml = await fetchEbayNotificationPreferenceLevel(accessToken, "User");
      if (userXml) {
        for (const event of enabledNotificationEvents(userXml)) {
          if (!events.includes(event)) events.push(event);
        }
      }
    } catch (e) {
      console.warn("[ebay] GetNotificationPreferences User level failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return {
      fetched: true,
      subscribed: appEnabled === "Enable" && !!appUrl,
      webhookUrl: appUrl || undefined,
      urlSecured: ebayWebhookUrlIsSecured(appUrl),
      events,
    };
  } catch (e) {
    console.error("[ebay] getEbayNotificationPreferences: exception", { error: e });
    return { fetched: false, subscribed: false };
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
