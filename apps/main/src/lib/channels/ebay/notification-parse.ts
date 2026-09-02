import { tag } from "./photos";
import { parseEbayGetItemAvailability } from "./trading";
import { parseEbayLastModified } from "./item-specifics";

export type EbayNotificationKind = "sale" | "revise" | "closed" | "other";

export type EbayNotificationPostcard = {
  title: string | null;
  priceCents: number | null;
  /** Parsed for logging only — never apply qty from a notification postcard. */
  quantity: number | null;
  lastModified: Date | null;
};

export type EbayNotificationEnvelope = {
  source: "soap" | "commerce_json";
  eventType: string | null;
  itemId: string | null;
  ebayUserId: string | null;
  kind: EbayNotificationKind;
  postcard: EbayNotificationPostcard;
  parseable: boolean;
};

const SALE_EVENTS = ["ItemSold", "FixedPriceTransaction", "AuctionCheckoutComplete", "ORDER_CONFIRMATION"];
const CLOSED_EVENTS = ["ItemClosed", "ItemUnsold"];
const REVISE_EVENTS = [
  "ItemRevised",
  "ItemRevisionAddedToSchedule",
  "ItemListed",
  "ITEM_PRICE_REVISION",
  "ITEM_AVAILABILITY",
];

export function isEbaySaleNotification(eventType: string | null): boolean {
  if (!eventType) return false;
  return SALE_EVENTS.some((e) => eventType.includes(e));
}

export function isEbayClosedNotification(eventType: string | null): boolean {
  if (!eventType) return false;
  return CLOSED_EVENTS.some((e) => eventType.includes(e));
}

export function isEbayReviseNotification(eventType: string | null): boolean {
  if (!eventType) return false;
  return REVISE_EVENTS.some((e) => eventType.includes(e));
}

export function isEbayRelevantNotification(eventType: string | null): boolean {
  if (!eventType) return true;
  return (
    isEbaySaleNotification(eventType) ||
    isEbayClosedNotification(eventType) ||
    isEbayReviseNotification(eventType)
  );
}

export function notificationKind(eventType: string | null): EbayNotificationKind {
  if (isEbaySaleNotification(eventType)) return "sale";
  if (isEbayClosedNotification(eventType)) return "closed";
  if (isEbayReviseNotification(eventType)) return "revise";
  return "other";
}

/** Prefer a 9–15 digit Trading ItemID; unwrap Commerce `v1|123|0` ids. */
export function extractEbayLegacyItemId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{9,15}$/.test(trimmed)) return trimmed;
  const rest = trimmed.match(/^v1\|(\d{9,15})(?:\||$)/i);
  if (rest?.[1]) return rest[1];
  const digits = trimmed.match(/(\d{9,15})/);
  return digits?.[1] ?? null;
}

function decodeXmlTitle(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function emptyPostcard(): EbayNotificationPostcard {
  return { title: null, priceCents: null, quantity: null, lastModified: null };
}

function postcardFromItemXml(itemXml: string): EbayNotificationPostcard {
  const titleRaw = tag(itemXml, "Title");
  const sellingStatus = tag(itemXml, "SellingStatus") ?? "";
  const priceStr =
    tag(sellingStatus, "CurrentPrice") ?? tag(itemXml, "StartPrice") ?? tag(itemXml, "CurrentPrice") ?? "";
  const priceCents = priceStr !== "" ? Math.round((Number(priceStr) || 0) * 100) : null;
  const availability = parseEbayGetItemAvailability(itemXml);
  return {
    title: titleRaw ? decodeXmlTitle(titleRaw) : null,
    priceCents: priceCents != null && priceCents > 0 ? priceCents : null,
    quantity: availability.quantity,
    lastModified: parseEbayLastModified(itemXml),
  };
}

function extractSoapUserId(xml: string): string | null {
  const seller = tag(xml, "Seller");
  if (seller) {
    const userId = tag(seller, "UserID");
    if (userId) return userId.trim();
  }
  const recipient = tag(xml, "RecipientUserID");
  if (recipient) return recipient.trim();
  const userId = tag(xml, "UserID");
  return userId?.trim() || null;
}

export function parseEbaySoapNotification(xml: string): EbayNotificationEnvelope {
  const eventType = (tag(xml, "NotificationEventName") || tag(xml, "EventName"))?.trim() || null;
  const itemBlock = tag(xml, "Item");
  const itemId =
    extractEbayLegacyItemId(itemBlock ? tag(itemBlock, "ItemID") : null) ??
    extractEbayLegacyItemId(tag(xml, "ItemID"));
  return {
    source: "soap",
    eventType,
    itemId,
    ebayUserId: extractSoapUserId(xml),
    kind: notificationKind(eventType),
    postcard: itemBlock ? postcardFromItemXml(itemBlock) : emptyPostcard(),
    parseable: Boolean(eventType || itemId),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function walkItemId(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const direct =
    extractEbayLegacyItemId(readString(data.itemId)) ??
    extractEbayLegacyItemId(readString(data.legacyItemId)) ??
    extractEbayLegacyItemId(readString(data.listingId));
  if (direct) return direct;
  const legacy = asRecord(data.legacyReference);
  return extractEbayLegacyItemId(readString(legacy?.legacyItemId));
}

function walkUserId(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  return (
    readString(data.username) ??
    readString(data.userId) ??
    readString(data.sellerId) ??
    readString(asRecord(data.seller)?.username)
  );
}

function commercePostcard(data: Record<string, unknown> | null): EbayNotificationPostcard {
  if (!data) return emptyPostcard();
  const title = readString(data.title);
  const priceRaw = data.price ?? data.currentPrice;
  let priceCents: number | null = null;
  if (typeof priceRaw === "number" && Number.isFinite(priceRaw) && priceRaw > 0) {
    priceCents = priceRaw >= 100 ? Math.round(priceRaw) : Math.round(priceRaw * 100);
  } else if (typeof priceRaw === "string" && priceRaw.trim()) {
    const n = Number(priceRaw);
    if (Number.isFinite(n) && n > 0) priceCents = Math.round(n * 100);
  } else {
    const priced = asRecord(priceRaw);
    const value = priced ? Number(priced.value ?? priced.amount) : NaN;
    if (Number.isFinite(value) && value > 0) priceCents = Math.round(value * 100);
  }
  return {
    title,
    priceCents,
    quantity: null,
    lastModified: null,
  };
}

export function parseEbayCommerceNotification(body: unknown): EbayNotificationEnvelope {
  const root = asRecord(body);
  const metadata = asRecord(root?.metadata);
  const notification = asRecord(root?.notification);
  const data = asRecord(notification?.data) ?? asRecord(root?.data);
  const eventType =
    readString(metadata?.topic) ??
    readString(root?.topic) ??
    readString(notification?.topic) ??
    readString(data?.topic);
  return {
    source: "commerce_json",
    eventType,
    itemId: walkItemId(data) ?? walkItemId(root),
    ebayUserId: walkUserId(data) ?? walkUserId(root),
    kind: notificationKind(eventType),
    postcard: commercePostcard(data),
    parseable: Boolean(eventType || walkItemId(data) || walkItemId(root)),
  };
}

/** SOAP XML or Commerce JSON (object or stringified). */
export function parseEbayNotificationBody(
  raw: string,
  contentType?: string | null
): EbayNotificationEnvelope {
  const trimmed = raw.trim();
  const looksJson =
    (contentType ?? "").toLowerCase().includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksJson) {
    try {
      return parseEbayCommerceNotification(JSON.parse(trimmed) as unknown);
    } catch {
      return {
        source: "commerce_json",
        eventType: null,
        itemId: null,
        ebayUserId: null,
        kind: "other",
        postcard: emptyPostcard(),
        parseable: false,
      };
    }
  }
  return parseEbaySoapNotification(raw);
}

/**
 * Title/price we may write from a notification snapshot.
 * Never returns qty — callers must not apply quantity from XML.
 */
export function ebayNotificationPostcardWrites(postcard: EbayNotificationPostcard): {
  title: string | null;
  priceCents: number | null;
} {
  const title = postcard.title?.trim() ? postcard.title.trim() : null;
  const priceCents = postcard.priceCents != null && postcard.priceCents > 0 ? postcard.priceCents : null;
  return { title, priceCents };
}
